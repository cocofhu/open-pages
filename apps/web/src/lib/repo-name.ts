import { publishRepoCheckMessage, type PublishRepoCheck } from "@open-pages/shared";

const NEW_REPO_CHECK: PublishRepoCheck = {
  eligible: true,
  reason: "new",
  message: publishRepoCheckMessage("new"),
};

const ONBOARD_NEW_REPO_CHECK: PublishRepoCheck = {
  eligible: true,
  reason: "new",
  message: "GitHub 上还没有这个仓库。同步后会新建并打开空白站点。",
};

/** Shared create-repo name rules for PublishPage and RepoOnboarding (plan g2.2). */
export function assessNewRepoName(
  name: string,
  repos: Array<{ name: string; fullName: string }>,
  opts?: { forOnboarding?: boolean },
): PublishRepoCheck {
  const trimmed = name.trim();
  if (
    !/^[A-Za-z0-9._-]{1,100}$/.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.startsWith(".") ||
    trimmed.endsWith(".")
  ) {
    return {
      eligible: false,
      reason: "foreign",
      message: "仓库名只能包含字母、数字、点、下划线和短横线，且不能以点开头或结尾。",
    };
  }
  const existing = repos.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    return {
      eligible: false,
      reason: "foreign",
      message: opts?.forOnboarding
        ? `仓库「${existing.fullName}」已存在。请改用「选择已有仓库」，或换一个名字。`
        : `仓库「${existing.fullName}」已存在。请关闭「创建新仓库」后选择它，或换一个名字。`,
    };
  }
  return opts?.forOnboarding ? ONBOARD_NEW_REPO_CHECK : NEW_REPO_CHECK;
}
