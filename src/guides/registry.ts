export const GUIDE_VERSION = "2.0";

export type GuideView = "home" | "sources" | "nodes" | "groups" | "rules" | "preview" | "history" | "generator" | "links" | "subscription" | "templates" | "settings" | "admin";

export const guideTargets = {
  subscriptionRules: "subscription-rules",
  subscriptionSave: "subscription-save",
  subscriptionSaved: "subscription-saved",
  homeTasks: "home-tasks",
  homeSubscriptions: "home-subscriptions",
  homePublish: "home-publish",
  publishReview: "publish-review",
  quickSetup: "quick-setup",
  quickImport: "quick-import",
  quickConfigure: "quick-configure",
  quickResult: "quick-result",
  homeHero: "home-hero",
  homeContinue: "home-continue",
  mainNavigation: "main-navigation",
  projectSelector: "project-selector",
  sourceToolbar: "source-toolbar",
  sourceAdd: "source-add",
  sourceList: "source-list",
  nodeDiagnostics: "node-diagnostics",
  publicationSync: "publication-sync",
  ruleScenario: "rule-scenario",
  nodeToolbar: "node-toolbar",
  nodeImport: "node-import",
  nodeList: "node-list",
  nodeSelection: "node-selection",
  groupBoard: "group-board",
  groupCreate: "group-create",
  groupNodePool: "group-node-pool",
  ruleMode: "rule-mode",
  ruleTemplates: "rule-templates",
  ruleAdd: "rule-add",
  ruleList: "rule-list",
  generatorSteps: "generator-steps",
  generatorMain: "generator-main",
  publishAction: "publish-action",
  helpButton: "help-button",
} as const;

export type GuideTargetId = typeof guideTargets[keyof typeof guideTargets];

export type GuideStep = {
  id: string;
  view: GuideView;
  target: GuideTargetId;
  title: string;
  description: string;
  tip?: string;
  quickStep?: number;
  advanceOn?: string;
};

export type GuideDefinition = {
  id: string;
  title: string;
  description: string;
  duration: string;
  steps: readonly GuideStep[];
};

export const guideRegistry: readonly GuideDefinition[] = [
  {
    id: "website", title: "让某个网站走指定线路", description: "添加中文网站规则，发布到原地址，再刷新客户端。", duration: "约 2 分钟",
    steps: [
      { id: "choose", view: "home", target: guideTargets.homeSubscriptions, advanceOn: "subscription-rules-opened", title: "先选中要修改的订阅", description: "在这份订阅的卡片上点击“编辑分流”，不是新建订阅。尚未生成过链接时，请先用三步教程创建。" },
      { id: "rule", view: "subscription", target: guideTargets.ruleScenario, advanceOn: "website-rule-added", title: "为网站选择连接方式", description: "填写域名，选择连接方式，点击“添加网站规则”。默认包含子域名，发布前不会影响客户端。" },
      { id: "publish", view: "subscription", target: guideTargets.subscriptionSave, advanceOn: "subscription-updated", title: "把规则更新到原订阅", description: "点击“检查并更新原订阅”，确认名称、数量变化与原地址不变，再点击确认。成功后回到手机或电脑客户端刷新订阅，不用重新填写地址。" },
    ],
  },
  {
    id: "troubleshoot", title: "订阅不能用，怎么办？", description: "区分来源拉取、节点连通和客户端刷新，避免盲目重装。", duration: "约 3 分钟",
    steps: [
      { id: "start", view: "home", target: guideTargets.homeTasks, title: "先判断哪里出了问题", description: "首页状态只表示链接是否过期、撤销或同步报错，不代表节点已通过实测。来源失败时上次发布内容仍保留，不要先重置地址。" },
      { id: "source", view: "sources", target: guideTargets.sourceList, title: "客户端能导入，服务器却报错？", description: "点击来源的“诊断连接”，查看 404、权限、DNS 或 TLS 建议。服务器网络与手机不同，404 不能靠换请求头保证修复。" },
      { id: "node", view: "nodes", target: guideTargets.nodeDiagnostics, title: "地址正常但连不上网络？", description: "使用“代理实测”验证鉴权和 HTTPS 转发。TCP 可达不等于代理可用；确认发布后还要在客户端刷新订阅，通常不需要重装应用。" },
    ],
  },
  {
    id: "quickstart",
    title: "三步创建第一个订阅",
    description: "导入节点、选择配置并发布；也可以沿用已有订阅更新原地址。",
    duration: "约 5 分钟",
    steps: [
      { id: "import", view: "home", target: guideTargets.quickImport, quickStep: 0, advanceOn: "imported", title: "粘贴并导入订阅", description: "第一次创建时，填写订阅或节点链接并点击“导入并继续”；已有节点也可以直接使用。导入成功后教程自动前进。", tip: "已有订阅要改内容时，先暂停教程，再到“我的订阅”选择对应卡片编辑。" },
      { id: "configure", view: "home", target: guideTargets.quickConfigure, quickStep: 1, advanceOn: "published", title: "选择推荐配置并发布", description: "可选推荐配置直接发布，也可点击“手动编辑分组后再发布”自定义分组与分流。检查变更摘要后确认发布；首次创建地址，之后更新原地址。" },
      { id: "copy", view: "home", target: guideTargets.quickResult, quickStep: 2, advanceOn: "copied", title: "复制到客户端", description: "复制订阅链接，在客户端的“订阅 / 配置”中从 URL 添加，然后更新订阅。后续可以继续使用同一个地址。" },
    ],
  },
  {
    id: "sources",
    title: "导入订阅与节点",
    description: "认识来源类型、同步入口和节点导入方式。",
    duration: "约 2 分钟",
    steps: [
      { id: "source-toolbar", view: "sources", target: guideTargets.sourceToolbar, title: "来源集中管理", description: "所有远程订阅、文件和分享链接都会保存在这里，后续可以单独刷新。" },
      { id: "source-add", view: "sources", target: guideTargets.sourceAdd, title: "添加一个来源", description: "远程订阅填写 URL；多条节点链接选择“分享链接”；完整配置选择“配置文件”。" },
      { id: "source-list", view: "sources", target: guideTargets.sourceList, title: "检查同步与诊断", description: "远程来源点击“诊断”可查看脱敏的 HTTP 状态、请求方式与处理建议。404 不一定是地址错误，也可能是来源 IP 限制。诊断不会修改节点。" },
    ],
  },
  {
    id: "nodes",
    title: "整理与检测节点",
    description: "选择项目节点、调整顺序并检查服务器连通性。",
    duration: "约 2 分钟",
    steps: [
      { id: "node-toolbar", view: "nodes", target: guideTargets.nodeToolbar, title: "筛选或添加节点", description: "可以按名称、服务器、协议、标签和来源筛选节点。" },
      { id: "node-list", view: "nodes", target: guideTargets.nodeList, title: "节点库与当前项目相互独立", description: "勾选节点后再加入当前项目。删除节点库数据前，系统会同步清理项目引用。" },
      { id: "node-diagnostics", view: "nodes", target: guideTargets.nodeDiagnostics, title: "检测并批量整理", description: "TCP 只检查端口；代理实测验证鉴权、HTTPS 转发和出口 IP。选择节点后还可以批量加入项目、检测、添加国旗、启停和整理名称。", tip: "检测从服务器发起，并不代表你的手机网络速度；出口检测会访问 Cloudflare，IP 定位可能有误差。" },
    ],
  },
  {
    id: "groups",
    title: "代理组与链式代理",
    description: "查看所有策略组，选择当前组并添加节点。",
    duration: "约 3 分钟",
    steps: [
      { id: "group-board", view: "groups", target: guideTargets.groupBoard, title: "从全部分组选择当前组", description: "“全部分组”列出所有策略组，选中后在“当前组”查看成员。组顺序手柄用于排序，嵌套手柄用于把组加入其他组。" },
      { id: "group-pool", view: "groups", target: guideTargets.groupNodePool, title: "添加内容到当前组", description: "先确认“添加到”的组名，再点击节点加号或勾选后批量加入。手机上切换到“添加内容”；也可以把节点拖入当前组成员区。" },
      { id: "group-create", view: "groups", target: guideTargets.groupCreate, title: "需要时再创建策略组", description: "点击“添加策略组”创建新组。手动选择适合入门；嵌套用于选择其他组，链式代理则按入口到出口放入具体节点。系统会阻止循环引用。" },
    ],
  },
  {
    id: "rules",
    title: "中文分流规则",
    description: "不用记英文代码，也能理解规则顺序和兜底逻辑。",
    duration: "约 3 分钟",
    steps: [
      { id: "rule-scenario", view: "rules", target: guideTargets.ruleScenario, title: "为网站选择线路", description: "填写域名和连接方式，点击“添加网站规则”。不用自己写英文代码。" },
      { id: "rule-template", view: "rules", target: guideTargets.ruleTemplates, title: "也可以用现成模板", description: "“基础分流”可生成常用规则。选择追加可保留已有设置。" },
      { id: "rule-list", view: "rules", target: guideTargets.ruleList, title: "按顺序检查规则", description: "规则从上往下匹配，兜底放最后。点击“编辑”修改内容并查看英文格式，检查后再发布。" },
    ],
  },
  {
    id: "publish",
    title: "生成并发布订阅",
    description: "使用向导生成可持续更新的订阅地址。",
    duration: "约 3 分钟",
    steps: [
      { id: "generator-steps", view: "generator", target: guideTargets.generatorSteps, title: "高级发布流程", description: "已有项目配置可直接发布；需要微调时返回选择节点、分组、规则或源码步骤。新手可优先使用首页三步流程。" },
      { id: "generator-main", view: "generator", target: guideTargets.generatorMain, title: "每一步都有即时预览", description: "右侧摘要和错误提示会随选择实时更新。" },
      { id: "publish-action", view: "generator", target: guideTargets.publishAction, title: "保存方案或发布链接", description: "第一次创建链接；之后选择已有发布记录即可在原地址更新内容。" },
    ],
  },
  {
    id: "sync", title: "保持订阅自动更新", description: "来源刷新后保留原地址更新内容，失败保留上一次发布。", duration: "约 1 分钟",
    steps: [{ id: "publication-sync", view: "links", target: guideTargets.publicationSync, title: "为已发布方案开启同步", description: "在订阅卡片中开启自动更新；勾选接收新增节点后，新节点会加入第一个代理组。最近错误和同步时间在同一位置显示。可立即同步验证，也可随时关闭。", tip: "请先生成一个订阅。客户端仍需手动或定时更新订阅，关闭来源并不等于停用节点。" }],
  },
] as const;

export function findGuide(id: string | undefined) {
  return guideRegistry.find((guide) => guide.id === id);
}
