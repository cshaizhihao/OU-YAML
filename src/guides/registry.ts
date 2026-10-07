export const GUIDE_VERSION = "1.5.0";

export type GuideView = "home" | "sources" | "nodes" | "groups" | "rules" | "preview" | "history" | "generator" | "links" | "templates" | "settings" | "admin";

export const guideTargets = {
  homeHero: "home-hero",
  homeContinue: "home-continue",
  mainNavigation: "main-navigation",
  projectSelector: "project-selector",
  sourceToolbar: "source-toolbar",
  sourceAdd: "source-add",
  sourceList: "source-list",
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
    title: "5 分钟创建第一个订阅",
    description: "从导入节点开始，依次完成节点选择、代理设置、分流和发布。",
    duration: "约 5 分钟",
    steps: [
      { id: "welcome", view: "home", target: guideTargets.homeHero, title: "从这里开始", description: "首页会读取当前配置状态，始终把最需要完成的步骤放在最前面。" },
      { id: "source", view: "sources", target: guideTargets.sourceAdd, title: "第一步：导入节点", description: "添加机场订阅 URL、节点分享链接或配置文件。保存远程订阅后会立即尝试同步。", tip: "不确定格式时保持“自动识别”即可。" },
      { id: "node-import", view: "nodes", target: guideTargets.nodeImport, title: "也可以直接导入分享链接", description: "VLESS、VMess、Trojan、SS 等链接可以在节点库直接解析预览。" },
      { id: "node-list", view: "nodes", target: guideTargets.nodeList, title: "第二步：挑选节点", description: "勾选要使用的节点，再点击“加入当前项目”。这里也能排序、TCP 检测和添加国家国旗。" },
      { id: "groups", view: "groups", target: guideTargets.groupBoard, title: "第三步：设置代理方式", description: "把节点拖入策略组。选择组用于手动切换，自动测速组会按延迟挑选。", tip: "新手只需要保留一个“节点选择”组也可以正常使用。" },
      { id: "rules", view: "rules", target: guideTargets.ruleMode, title: "第四步：设置中文分流", description: "默认的新手模式用中文解释每一种规则，实际导出仍然是标准英文规则。" },
      { id: "rule-template", view: "rules", target: guideTargets.ruleTemplates, title: "优先使用规则模板", description: "第一次使用建议选择“基础分流”，再把默认目标策略设为节点选择。" },
      { id: "generate", view: "generator", target: guideTargets.generatorSteps, title: "第五步：生成订阅", description: "按照页面上的五步向导选择节点、确认分组和规则，最后发布订阅。" },
      { id: "publish", view: "generator", target: guideTargets.generatorMain, title: "持续更新同一个地址", description: "保存生成方案后，后续可以更新原链接，客户端中的订阅地址不会改变。" },
      { id: "help", view: "home", target: guideTargets.helpButton, title: "随时重新打开教程", description: "点击右下角的帮助按钮，可以继续、重看或只学习当前功能。" },
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
      { id: "source-list", view: "sources", target: guideTargets.sourceList, title: "检查同步状态", description: "卡片会显示节点数量、同步周期、请求模式和最近错误。" },
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
      { id: "group-board", view: "groups", target: guideTargets.groupBoard, title: "组也可以放入组中", description: "拖动整个策略组到另一个组，可建立嵌套或链式代理；系统会阻止循环引用。" },
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
      { id: "generator-steps", view: "generator", target: guideTargets.generatorSteps, title: "五步发布流程", description: "依次选择节点、确认分组、选择规则、检查源码和发布。" },
      { id: "generator-main", view: "generator", target: guideTargets.generatorMain, title: "每一步都有即时预览", description: "右侧摘要和错误提示会随选择实时更新。" },
      { id: "publish-action", view: "generator", target: guideTargets.publishAction, title: "保存方案或发布链接", description: "第一次创建链接；之后选择已有发布记录即可在原地址更新内容。" },
    ],
  },
] as const;

export function findGuide(id: string | undefined) {
  return guideRegistry.find((guide) => guide.id === id);
}
