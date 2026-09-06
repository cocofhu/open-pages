export function switchRepoConfirmCopy(opts: {
  owner: string;
  repo: string;
  createRepo: boolean;
}): { title: string; message: string; confirmLabel: string } {
  const fullName = `${opts.owner}/${opts.repo}`;
  if (opts.createRepo) {
    return {
      title: "创建新仓库并重置本地？",
      message: `将在 GitHub 新建「${fullName}」。本地会重置为空白站点，当前文章不会带到新仓库。`,
      confirmLabel: "重置并创建",
    };
  }
  return {
    title: "切换到新仓库？",
    message: `本地文章、页面和配置会全部换成「${fullName}」里的内容，还没发布的改动会丢掉。`,
    confirmLabel: "覆盖并切换",
  };
}
