// @ts-check
// Git 供應者：gitlab（第三十輪）。對自架 GitLab 的 REST API v4，與 git-local.mjs 同一組方法。
// 原型環境沒有 GitLab 可連，這支依官方文件的端點寫成、以假的 fetch 做單元測試（tests/round30-gateway.test.mjs），
// 上線前資訊室要在測試專案實跑一次（docs/deploy.md §14.6 驗收清單）。
//
// 用到的端點（全部以服務帳號的 token 呼叫，標頭 PRIVATE-TOKEN）：
//   GET  /projects/:id/repository/files/:path/raw?ref=          讀檔（404 ⇒ null）
//   HEAD /projects/:id/repository/files/:path?ref=              判斷 create 還是 update
//   GET  /projects/:id/repository/branches/:branch              分支是否存在
//   POST /projects/:id/repository/branches                      { branch, ref } 建分支
//   POST /projects/:id/repository/commits                       { branch, commit_message, author_name, author_email, actions[] } 一次提交多檔
//   GET  /projects/:id/merge_requests?state=opened&source_branch=  找既有 MR
//   POST /projects/:id/merge_requests                           { source_branch, target_branch, title, description, labels, remove_source_branch }
//   PUT  /projects/:id/merge_requests/:iid                      { labels } 或 { state_event: 'close' }
//   POST /projects/:id/merge_requests/:iid/notes                { body } 留言（退回意見）
//   POST /projects/:id/merge_requests/:iid/approve              核准（以服務帳號；真正的審核人寫在留言與合併訊息）
//   PUT  /projects/:id/merge_requests/:iid/merge                { merge_commit_message, should_remove_source_branch, sha }
//   GET  /projects/:id/repository/compare?from=&to=&straight=false  變更檔案
// 需要的 token 權限：api（project access token，角色 Developer 即可；main 設保護分支，只允許這個服務帳號合併）。

/**
 * @param {{ baseUrl: string, project: string|number, token: string, targetBranch?: string, fetchFn?: typeof fetch, timeoutMs?: number }} opts
 */
export function createGitLab({ baseUrl, project, token, targetBranch = 'main', fetchFn = fetch, timeoutMs = 15000 }) {
  if (!baseUrl || !project || !token) throw new Error('gitlab 供應者需要 baseUrl、project、token');
  const root = `${String(baseUrl).replace(/\/$/, '')}/api/v4/projects/${encodeURIComponent(String(project))}`;
  const enc = (p) => encodeURIComponent(p);
  async function call(method, pathAndQuery, body, { okStatus = [200, 201], allow404 = false } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchFn(`${root}${pathAndQuery}`, {
        method, signal: ctl.signal,
        headers: { 'PRIVATE-TOKEN': token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (allow404 && r.status === 404) return null;
      if (!okStatus.includes(r.status)) {
        let detail = ''; try { detail = JSON.stringify(await r.json()).slice(0, 300); } catch { /* 非 JSON */ }
        throw Object.assign(new Error(`GitLab ${method} ${pathAndQuery.split('?')[0]} → ${r.status} ${detail}`), { code: r.status === 409 || r.status === 406 ? 'conflict' : 'gitlab', status: r.status });
      }
      if (method === 'HEAD') return true;
      const type = r.headers?.get?.('content-type') ?? '';
      return type.includes('application/json') ? r.json() : r.text();
    } finally { clearTimeout(timer); }
  }
  const findOpenMr = async (branch) => (await call('GET', `/merge_requests?state=opened&source_branch=${enc(branch)}&target_branch=${enc(targetBranch)}`))?.[0] ?? null;

  return {
    name: 'gitlab', targetBranch,
    async ensureReady() { await call('GET', ''); }, // 專案存在且 token 有效
    async readFile(ref, filePath) { return call('GET', `/repository/files/${enc(filePath)}/raw?ref=${enc(ref)}`, null, { allow404: true }); },
    async branchExists(branch) { return !!(await call('GET', `/repository/branches/${enc(branch)}`, null, { allow404: true })); },
    async createBranch(branch, from = targetBranch) { const b = await call('POST', '/repository/branches', { branch, ref: from }); return { sha: b?.commit?.id ?? null }; },
    async commit({ branch, files, message, author }) {
      const actions = [];
      for (const f of files) {
        if (f.content == null) { actions.push({ action: 'delete', file_path: f.path }); continue; }
        const exists = await call('HEAD', `/repository/files/${enc(f.path)}?ref=${enc(branch)}`, null, { allow404: true });
        actions.push({ action: exists ? 'update' : 'create', file_path: f.path, content: f.content, encoding: 'text' });
      }
      const c = await call('POST', '/repository/commits', { branch, commit_message: message, ...(author ? { author_name: author.name, author_email: author.email } : {}), actions });
      return { sha: c?.id ?? null };
    },
    async openReview({ branch, title, description = '', labels = [] }) {
      const open = await findOpenMr(branch);
      if (open) { await call('PUT', `/merge_requests/${open.iid}`, { title, description, labels: labels.join(',') }); return { id: open.iid, url: open.web_url }; }
      const mr = await call('POST', '/merge_requests', { source_branch: branch, target_branch: targetBranch, title, description, labels: labels.join(','), remove_source_branch: true, squash: false });
      return { id: mr.iid, url: mr.web_url };
    },
    async setLabels(id, labels) { await call('PUT', `/merge_requests/${id}`, { labels: labels.join(',') }); },
    async comment(id, body) { await call('POST', `/merge_requests/${id}/notes`, { body }); },
    // GitLab 上的「核准」只是鏡像：所有動作都是同一個服務帳號，第二次核准會回 401（已核准過），
    // 開了「禁止作者核准」也會被拒。真正的核准人記在留言、合併訊息的 Approved-by 與閘道稽核，所以這幾種回應不當失敗。
    async approve(id) {
      try { await call('POST', `/merge_requests/${id}/approve`, {}); return { recorded: true }; } catch (e) {
        if ([401, 403, 405].includes(e?.status)) return { recorded: false };
        throw e;
      }
    },
    async closeReview(id) { await call('PUT', `/merge_requests/${id}`, { state_event: 'close' }); },
    async changedFiles(branch) {
      const cmp = await call('GET', `/repository/compare?from=${enc(targetBranch)}&to=${enc(branch)}&straight=false`);
      return (cmp?.diffs ?? []).map((d) => d.new_path);
    },
    async merge(id, { message }) {
      const mr = await call('GET', `/merge_requests/${id}`);
      const r = await call('PUT', `/merge_requests/${id}/merge`, { merge_commit_message: message, should_remove_source_branch: true, sha: mr?.sha });
      return { sha: r?.merge_commit_sha ?? null };
    },
  };
}
