export const GUIDE_VERSION = "1.7";

export type GuideView = "home" | "sources" | "nodes" | "groups" | "rules" | "preview" | "history" | "generator" | "links" | "templates" | "settings" | "admin";

export const guideTargets = {
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
    id: "quickstart",
    title: "三步创建第一个订阅",
    description: "粘贴链接、选择推荐设置、复制订阅，成功后自动前进。",
    duration: "约 5 分钟",
    steps: [
      { id: "import", view: "home", target: guideTargets.quickImport, quickStep: 0, advanceOn: "imported", title: "粘贴并导入订阅", description: "填写订阅或节点链接，点击“导入并继续”。如果已有节点，可以直接使用。导入成功后教程自动前进。", tip: "只想了解流程时，可以暂停教程并点击“先看演示”。" },
      { id: "configure", view: "home", target: guideTargets.quickConfigure, quickStep: 1, advanceOn: "published", title: "选择推荐配置并发布", description: "基础分流适合 Mihomo。检查节点选择后点击“生成我的订阅”，系统完成校验、分组和发布。失败原因会显示在页面下方。" },
      { id: "copy", view: "home", target: guideTargets.quickResult, quickStep: 2, advanceOn: "copied", title: "复制到客户端", description: "复制订阅链接，在客户端的“订阅 / 配置”中从 URL 添加，然后更新订阅。后续可以继续使用同一个地址。" },
      { id: "help", view: "home", target: guideTargets.helpButton, title: "随时继续学习", description: "右下角可以学习节点实测、分流和自动同步。日后有新的操作方式，会在这里提示新增教程。" },
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
      { id: "node-diagnostics", view: "nodes", target: guideTargets.nodeDiagnostics, title: "选择真实检测方式", description: "TCP 只检查端口。代理实测通过服务器上的 Mihomo 内核验证鉴权、HTTPS 转发并读取出口 IP。Hysteria2 / TUIC 请选代理实测。国旗可按入口或出口添加，不会把入口误当出口。", tip: "检测从服务器发起，并不代表你的手机网络速度；出口检测会访问 Cloudflare，IP 定位可能有误差。" },
      { id: "node-selection", view: "nodes", target: guideTargets.nodeSelection, title: "批量操作", description: "选择节点后可以批量加入项目、检测 TCP、添加国旗、启停和整理名称。" },
    ],
  },
  {
    id: "groups",
    title: "代理组与链式代理",
    description: "学习把节点和策略组拖入目标组。",
    duration: "约 3 分钟",
    steps: [
      { id: "group-create", view: "groups", target: guideTargets.groupCreate, title: "创建策略组", description: "选择组用于手动切换；自动测速、故障转移和负载均衡适合进阶使用。" },
      { id: "group-pool", view: "groups", target: guideTargets.groupNodePool, title: "从节点池拖入", description: "把左侧节点拖到中间的策略组，也可以使用卡片中的快速添加。" },
      { id: "group-board", view: "groups", target: guideTargets.groupBoard, title: "组也可以放入组中", description: "拖动整个策略组到另一个组，可建立嵌套选择，但并不意味着流量逐跳转发。链式代理请选择对应类型，按入口到出口放入具体节点；导出时转换成 Mihomo 的 dialer-proxy。系统会阻止循环引用。" },
    ],
  },
  {
    id: "rules",
    title: "中文分流规则",
    description: "不用记英文代码，也能理解规则顺序和兜底逻辑。",
    duration: "约 3 分钟",
    steps: [
      { id: "rule-mode", view: "rules", target: guideTargets.ruleMode, title: "新手与高级模式", description: "新手模式使用自然语言；高级模式保留完整表格和原始参数。" },
      { id: "rule-template", view: "rules", target: guideTargets.ruleTemplates, title: "一键应用模板", description: "模板会自动生成常用规则，并保证最终兜底规则位于末尾。" },
      { id: "rule-scenario", view: "rules", target: guideTargets.ruleScenario, title: "像写中文句子一样分流", description: "填写网站域名，选择“含子域名”和目标策略，即可添加标准英文规则。匹配检查会说明先命中哪一条；涉及规则集或 IP 时会标为不能仅凭域名确定。" },
      { id: "rule-add", view: "rules", target: guideTargets.ruleAdd, title: "添加自定义规则", description: "选择中文匹配方式后，输入框会展示对应示例和说明。" },
      { id: "rule-list", view: "rules", target: guideTargets.ruleList, title: "从上到下依次匹配", description: "规则命中后不会继续向下检查，因此越具体的规则越应该放在前面。" },
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
