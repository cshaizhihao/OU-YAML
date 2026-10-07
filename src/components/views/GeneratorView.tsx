import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Database, FileCode2, Filter, Layers3, LoaderCircle, Plus, Rocket, Save, Search, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../api";
import { guideTargets } from "../../guides/registry";
import { exportMihomoYaml, validateConfig } from "../../shared/mihomo";
import { exportSingBoxJson } from "../../shared/singbox";
import { applyRuleTemplate, ruleTemplates } from "../../shared/ruleTemplates";
import { createId } from "../../shared/id";
import { ruleTargetLabel } from "../../shared/ruleCatalog";
import type { GeneratedSubscription, GenerationProfile, ManagedNode, NodeSource } from "../../shared/domain";
import type { MihomoConfig, Project, ProxyNode, RuleItem, TargetFormat } from "../../shared/types";
import { ConfirmDialog } from "../Dialog";

type TemplateResource = { id: string; name: string; description: string; targetFormat: TargetFormat; content: unknown[]; builtin: boolean };
type CatalogNode = { node: ProxyNode; sourceId?: string; sourceName: string; enabled: boolean; tags: string[]; note?: string };
type PublishResult = { id: string; version: number; token?: string; stable: boolean };

const steps = ["选择节点", "代理分组", "规则模板", "预览校验", "保存与发布"];

function managedProxy(node: ManagedNode): ProxyNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    server: node.server,
    port: node.port,
    udp: node.udp,
    tls: node.tls,
    skipCertVerify: node.skipCertVerify,
    sni: node.sni,
    uuid: node.uuid,
    password: node.password,
    cipher: node.cipher,
    network: node.network,
    wsPath: node.wsPath,
    wsHost: node.wsHost,
    grpcServiceName: node.grpcServiceName,
    extra: node.extra || {},
    formatExtra: node.formatExtra,
  };
}

function customTemplateRules(template: TemplateResource, target: string): RuleItem[] {
  return template.content.flatMap<RuleItem>((value) => {
    if (typeof value === "string") {
      const parts = value.split(",").map((part) => part.trim());
      if (!parts[0]) return [];
      if (parts[0] === "MATCH") return [{ id: createId(), type: "MATCH", value: "", target: parts[1] || target, options: parts.slice(2), enabled: true }];
      if (!parts[1]) return [];
      return [{ id: createId(), type: parts[0], value: parts[1], target: parts[2] || target, options: parts.slice(3), enabled: true }];
    }
    if (!value || typeof value !== "object") return [];
    const item = value as Partial<RuleItem>;
    if (!item.type) return [];
    return [{ id: createId(), type: String(item.type), value: item.type === "MATCH" ? "" : String(item.value || ""), target: item.target === "$TARGET" ? target : String(item.target || target), options: Array.isArray(item.options) ? item.options.map(String) : [], enabled: item.enabled !== false, comment: item.comment }];
  });
}

function buildConfig(base: MihomoConfig, catalog: CatalogNode[], selectedIds: Set<string>, templateChoice: string, templateTarget: string, resources: TemplateResource[]) {
  const structureNames = new Map(base.proxies.map((node) => [node.id, node.name]));
  const usedNames = new Set<string>();
  const proxies = catalog.filter((item) => selectedIds.has(item.node.id)).map((item) => {
    const preferred = structureNames.get(item.node.id) || item.node.name || `${item.node.type.toUpperCase()} 节点`;
    let name = preferred;
    let suffix = 2;
    while (usedNames.has(name)) name = `${preferred} ${suffix++}`;
    usedNames.add(name);
    return { ...item.node, name };
  });
  const nameById = new Map(proxies.map((node) => [node.id, node.name]));
  const oldToNewName = new Map(base.proxies.map((node) => [node.name, nameById.get(node.id)]).filter((entry): entry is [string, string] => !!entry[1]));
  const groupNames = new Set(base.proxyGroups.map((group) => group.name));
  let proxyGroups = base.proxyGroups.map((group) => ({
    ...group,
    proxies: [...new Set(group.proxies.map((member) => oldToNewName.get(member) || member).filter((member) => usedNames.has(member) || groupNames.has(member) || member === "DIRECT" || member === "REJECT"))],
  }));
  if (!proxyGroups.length) proxyGroups = [{ id: createId(), name: "节点选择", type: "select", proxies: [], extra: {} }];
  const assigned = new Set(proxyGroups.flatMap((group) => group.proxies));
  proxyGroups[0] = { ...proxyGroups[0], proxies: [...proxyGroups[0].proxies, ...proxies.map((node) => node.name).filter((name) => !assigned.has(name))] };
  if (!proxyGroups[0].proxies.length) proxyGroups[0] = { ...proxyGroups[0], proxies: ["DIRECT"] };
  let config: MihomoConfig = {
    ...base,
    proxies,
    proxyGroups,
    rules: base.rules.map((rule) => ({ ...rule, target: groupNames.has(rule.target) || rule.target === "DIRECT" || rule.target === "REJECT" ? rule.target : proxyGroups[0].name })),
  };
  if (templateChoice.startsWith("builtin:")) config = applyRuleTemplate(config, templateChoice.slice(8), templateTarget, "replace");
  if (templateChoice.startsWith("resource:")) {
    const template = resources.find((item) => item.id === templateChoice.slice(9));
    if (template) {
      const rules = customTemplateRules(template, templateTarget);
      if (!rules.some((rule) => rule.type === "MATCH")) rules.push({ id: createId(), type: "MATCH", value: "", target: templateTarget, options: [], enabled: true });
      config = { ...config, rules };
    }
  }
  return config;
}

export function GeneratorView({ project, onMessage }: { project: Project; onMessage: (message: string) => void }) {
  const [step, setStep] = useState(0);
  const [profiles, setProfiles] = useState<GenerationProfile[]>([]);
  const [publications, setPublications] = useState<GeneratedSubscription[]>([]);
  const [managedNodes, setManagedNodes] = useState<ManagedNode[]>([]);
  const [sources, setSources] = useState<NodeSource[]>([]);
  const [templates, setTemplates] = useState<TemplateResource[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileName, setProfileName] = useState(`${project.name} · 发布方案`);
  const [subscriptionName, setSubscriptionName] = useState(`${project.name} · 订阅`);
  const [targetFormat, setTargetFormat] = useState<TargetFormat>(project.targetFormat);
  const [structureConfig, setStructureConfig] = useState<MihomoConfig>(project.config);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(project.config.proxies.map((node) => node.id)));
  const [sourceFilter, setSourceFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [query, setQuery] = useState("");
  const [templateChoice, setTemplateChoice] = useState("current");
  const [templateTarget, setTemplateTarget] = useState(project.config.proxyGroups[0]?.name || "DIRECT");
  const [publicationId, setPublicationId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [deletingProfile, setDeletingProfile] = useState<GenerationProfile | null>(null);

  async function loadResources() {
    const [nextProfiles, nextPublications, nextNodes, nextSources, nextTemplates] = await Promise.all([
      api.listGenerationProfiles(),
      api.listGeneratedSubscriptions(),
      api.listManagedNodes(),
      api.listNodeSources(),
      api.listRuleTemplates(),
    ]);
    setProfiles(nextProfiles);
    setPublications(nextPublications);
    setManagedNodes(nextNodes);
    setSources(nextSources);
    setTemplates(nextTemplates as TemplateResource[]);
  }

  useEffect(() => {
    setLoading(true);
    void loadResources().catch((error) => onMessage(error instanceof Error ? error.message : "生成资源加载失败")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setProfileId("");
    setProfileName(`${project.name} · 发布方案`);
    setSubscriptionName(`${project.name} · 订阅`);
    setTargetFormat(project.targetFormat);
    setStructureConfig(project.config);
    setSelectedIds(new Set(project.config.proxies.map((node) => node.id)));
    setTemplateChoice("current");
    setTemplateTarget(project.config.proxyGroups[0]?.name || "DIRECT");
    setPublicationId("");
    setPublished(null);
  }, [project.id]);

  const sourceNames = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources]);
  const catalog = useMemo<CatalogNode[]>(() => {
    const projectById = new Map(project.config.proxies.map((node) => [node.id, node]));
    const rows: CatalogNode[] = managedNodes.map((managed) => ({ node: projectById.get(managed.id) || managedProxy(managed), sourceId: managed.sourceId, sourceName: managed.sourceId ? sourceNames.get(managed.sourceId) || "未知来源" : "手动节点", enabled: managed.enabled, tags: managed.tags, note: managed.note }));
    const known = new Set(rows.map((item) => item.node.id));
    for (const node of project.config.proxies) if (!known.has(node.id)) rows.push({ node, sourceName: "当前项目", enabled: true, tags: [] });
    return rows;
  }, [managedNodes, project.config.proxies, sourceNames]);
  const tags = useMemo(() => [...new Set(catalog.flatMap((item) => item.tags))].sort((left, right) => left.localeCompare(right, "zh-CN")), [catalog]);
  const visibleNodes = useMemo(() => catalog.filter((item) => {
    const text = `${item.node.name} ${item.node.server} ${item.node.type} ${item.tags.join(" ")} ${item.note || ""}`.toLowerCase();
    return (!sourceFilter || item.sourceId === sourceFilter) && (!tagFilter || item.tags.includes(tagFilter)) && text.includes(query.trim().toLowerCase());
  }), [catalog, query, sourceFilter, tagFilter]);
  const generatedConfig = useMemo(() => buildConfig(structureConfig, catalog, selectedIds, templateChoice, templateTarget, templates), [structureConfig, catalog, selectedIds, templateChoice, templateTarget, templates]);
  const content = useMemo(() => targetFormat === "sing-box" ? exportSingBoxJson(generatedConfig) : exportMihomoYaml(generatedConfig), [generatedConfig, targetFormat]);
  const issues = useMemo(() => validateConfig(generatedConfig), [generatedConfig]);
  const errors = issues.filter((issue) => issue.level === "error");
  const profilePublications = publications.filter((item) => item.profileId === profileId && item.targetFormat === targetFormat && !item.revoked);
  const selectedTemplateId = templateChoice.startsWith("resource:") ? templateChoice.slice(9) : undefined;
  const selectedSourceIds = [...new Set(catalog.filter((item) => selectedIds.has(item.node.id) && item.sourceId).map((item) => item.sourceId!))];

  function newProfile() {
    setProfileId("");
    setProfileName(`${project.name} · 发布方案`);
    setSubscriptionName(`${project.name} · 订阅`);
    setTargetFormat(project.targetFormat);
    setStructureConfig(project.config);
    setSelectedIds(new Set(project.config.proxies.map((node) => node.id)));
    setTemplateChoice("current");
    setTemplateTarget(project.config.proxyGroups[0]?.name || "DIRECT");
    setPublicationId("");
    setExpiresAt("");
    setPublished(null);
    setStep(0);
  }

  function chooseProfile(id: string) {
    if (!id) return newProfile();
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    setProfileId(profile.id);
    setProfileName(profile.name);
    setSubscriptionName(profile.name.replace(/方案$/, "订阅"));
    setTargetFormat(profile.targetFormat);
    setStructureConfig(profile.config);
    setSelectedIds(new Set(profile.nodeIds.length ? profile.nodeIds : profile.config.proxies.map((node) => node.id)));
    setTemplateChoice(profile.templateId ? `resource:${profile.templateId}` : "current");
    setTemplateTarget(profile.config.proxyGroups[0]?.name || "DIRECT");
    setPublicationId(publications.find((item) => item.profileId === profile.id && !item.revoked)?.id || "");
    setPublished(null);
    setStep(0);
  }

  async function upsertProfile() {
    const payload = { name: profileName.trim() || `${project.name} · 发布方案`, targetFormat, config: generatedConfig, nodeIds: generatedConfig.proxies.map((node) => node.id), sourceIds: selectedSourceIds, templateId: selectedTemplateId };
    const saved = profileId ? await api.updateGenerationProfile(profileId, payload) : await api.createGenerationProfile(payload);
    setProfileId(saved.id);
    setProfiles((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    return saved;
  }

  async function saveProfileOnly() {
    if (errors.length) { onMessage(`请先修复 ${errors.length} 个配置错误`); setStep(3); return; }
    setBusy(true);
    try {
      await upsertProfile();
      onMessage(profileId ? "生成方案已更新" : "生成方案已保存");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "方案保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (errors.length) { onMessage(`请先修复 ${errors.length} 个配置错误`); setStep(3); return; }
    if (!selectedIds.size) { onMessage("请至少选择一个节点"); setStep(0); return; }
    setBusy(true);
    try {
      const profile = await upsertProfile();
      const expiration = expiresAt ? new Date(expiresAt).toISOString() : undefined;
      if (publicationId) {
        const result = await api.updateGeneratedSubscription(publicationId, { name: subscriptionName.trim() || profile.name, content, nodeCount: generatedConfig.proxies.length, expiresAt: expiration });
        setPublications((current) => current.map((item) => item.id === result.id ? result : item));
        setPublished({ id: result.id, version: result.version, stable: true });
        onMessage(`订阅已原地址更新至 v${result.version}`);
      } else {
        const result = await api.publishGeneratedSubscription({ profileId: profile.id, name: subscriptionName.trim() || profile.name, targetFormat, content, nodeCount: generatedConfig.proxies.length, expiresAt: expiration });
        setPublications((current) => [result, ...current]);
        setPublicationId(result.id);
        setPublished({ id: result.id, version: result.version, token: result.token, stable: false });
        onMessage("订阅已发布");
      }
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile() {
    if (!deletingProfile) return;
    try {
      await api.deleteGenerationProfile(deletingProfile.id);
      setProfiles((current) => current.filter((item) => item.id !== deletingProfile.id));
      setPublications((current) => current.filter((item) => item.profileId !== deletingProfile.id));
      if (profileId === deletingProfile.id) newProfile();
      setDeletingProfile(null);
      onMessage("生成方案及其发布记录已删除");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "生成方案删除失败");
    }
  }

  const publishedUrl = published?.token ? `${window.location.origin}/sub/${published.token}` : "";
  if (loading) return <div className="panel-loading"><LoaderCircle className="spin" size={22} />正在载入生成资源</div>;

  return <div className="generator-shell">
    <div className="profile-toolbar">
      <div><span className="eyebrow">GENERATION PROFILE</span><label><span>生成方案</span><select value={profileId} onChange={(event) => chooseProfile(event.target.value)}><option value="">新建方案</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label></div>
      <div className="row-actions"><button className="secondary-button compact-button" onClick={newProfile}><Plus size={15} />新建</button>{profileId && <><button className="secondary-button compact-button" onClick={() => { setProfileId(""); setProfileName(`${profileName} 副本`); setPublicationId(""); setPublished(null); }}><Copy size={15} />另存副本</button><button className="icon-button compact danger" onClick={() => setDeletingProfile(profiles.find((item) => item.id === profileId) || null)} aria-label="删除生成方案"><Trash2 size={16} /></button></>}</div>
    </div>

    <div className="wizard-steps" data-guide-id={guideTargets.generatorSteps}>{steps.map((label, index) => <button key={label} className={index === step ? "wizard-step active" : index < step ? "wizard-step complete" : "wizard-step"} onClick={() => setStep(index)}><span>{index < step ? <Check size={15} /> : index + 1}</span>{label}</button>)}</div>
    <div className="generator-layout">
      <section className="generator-main" data-guide-id={guideTargets.generatorMain}><div className="panel-card generator-card">
        <div className="panel-card-heading"><div><span className="eyebrow">OU-YAML / GENERATOR</span><h2>{steps[step]}</h2><p>保存可复用方案，也可以持续更新同一个订阅地址。</p></div><Sparkles size={24} className="accent-icon" /></div>

        {step === 0 && <div className="generator-node-step">
          <div className="generator-filters"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" /></label><label><Filter size={15} /><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">全部来源</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label><label><Filter size={15} /><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">全部标签</option>{tags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}</select></label></div>
          <div className="generator-select-all"><span>已选择 <strong>{selectedIds.size}</strong> / {catalog.length} 个节点</span><div><button className="text-button" onClick={() => setSelectedIds((current) => new Set([...current, ...visibleNodes.filter((item) => item.enabled).map((item) => item.node.id)]))}>选择当前已启用</button><button className="text-button" onClick={() => setSelectedIds((current) => new Set([...current].filter((id) => !visibleNodes.some((item) => item.node.id === id))))}>清除当前</button></div></div>
          <div className="generator-node-list">{visibleNodes.map((item) => <label className={`${selectedIds.has(item.node.id) ? "selected" : ""}${item.enabled ? "" : " disabled"}`} key={item.node.id}><input type="checkbox" checked={selectedIds.has(item.node.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(item.node.id) : next.delete(item.node.id); return next; })} /><span className="entity-icon"><Database size={15} /></span><span><strong title={item.node.name}>{item.node.name}</strong><small>{item.node.type.toUpperCase()} · {item.sourceName}{item.tags.length ? ` · ${item.tags.join(" / ")}` : ""}</small></span>{!item.enabled && <b>已停用</b>}</label>)}</div>
        </div>}

        {step === 1 && <div className="generator-preview"><div className="generator-section-intro"><Layers3 size={20} /><div><h3>沿用当前方案的分组结构</h3><p>未选择的节点会自动从分组移除；新增节点会加入第一个策略组。</p></div></div>{generatedConfig.proxyGroups.map((group) => <div className="generator-row" key={group.id}><span title={group.name}>{group.name}</span><span className="type-badge">{group.type}</span><small>{group.proxies.length} 个成员</small></div>)}</div>}

        {step === 2 && <div className="template-choice-grid">
          <button className={templateChoice === "current" ? "template-choice active" : "template-choice"} onClick={() => setTemplateChoice("current")}><FileCode2 size={19} /><span><strong>保留当前规则</strong><small>{structureConfig.rules.length} 条规则</small></span>{templateChoice === "current" && <Check size={16} />}</button>
          {ruleTemplates.map((template) => <button className={templateChoice === `builtin:${template.id}` ? "template-choice active" : "template-choice"} key={template.id} onClick={() => setTemplateChoice(`builtin:${template.id}`)}><Sparkles size={19} /><span><strong>{template.name}</strong><small>{template.rules.length} 条内置规则</small></span>{templateChoice === `builtin:${template.id}` && <Check size={16} />}</button>)}
          {templates.filter((template) => template.targetFormat === targetFormat).map((template) => <button className={templateChoice === `resource:${template.id}` ? "template-choice active" : "template-choice"} key={template.id} onClick={() => setTemplateChoice(`resource:${template.id}`)}><FileCode2 size={19} /><span><strong>{template.name}</strong><small>{template.content.length} 条资源模板规则</small></span>{templateChoice === `resource:${template.id}` && <Check size={16} />}</button>)}
          {templateChoice !== "current" && <label className="template-target">模板默认目标策略<select value={templateTarget} onChange={(event) => setTemplateTarget(event.target.value)}><option value="DIRECT">{ruleTargetLabel("DIRECT")}</option>{generatedConfig.proxyGroups.map((group) => <option value={group.name} key={group.id}>{group.name}</option>)}</select></label>}
        </div>}

        {step === 3 && <div className="code-preview"><header><span><FileCode2 size={16} />配置预览 · {targetFormat === "sing-box" ? "JSON" : "YAML"}</span><button className="secondary-button compact-button" onClick={() => navigator.clipboard?.writeText(content).then(() => onMessage("配置已复制"))}>复制源码</button></header><pre>{content}</pre>{issues.length > 0 && <div className="preview-issues">{issues.slice(0, 8).map((issue, index) => <span className={issue.level} key={`${issue.message}-${index}`}>{issue.message}</span>)}{issues.length > 8 && <small>还有 {issues.length - 8} 条检查结果</small>}</div>}{!issues.length && <div className="preview-valid"><CheckCircle2 size={17} />结构校验通过</div>}</div>}

        {step === 4 && <div className="publish-panel">
          <div className="form-grid"><label className="span-2">方案名称<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label>输出格式<select value={targetFormat} onChange={(event) => { setTargetFormat(event.target.value as TargetFormat); setPublicationId(""); setPublished(null); }}><option value="mihomo">Mihomo YAML</option><option value="sing-box">sing-box JSON</option></select></label><label>订阅名称<input value={subscriptionName} onChange={(event) => setSubscriptionName(event.target.value)} /></label><label className="span-2">发布方式<select value={publicationId} onChange={(event) => { setPublicationId(event.target.value); setPublished(null); }}><option value="">创建新的公开订阅链接</option>{profilePublications.map((item) => <option value={item.id} key={item.id}>更新原链接 · {item.name} · 当前 v{item.version}</option>)}</select></label><label className="span-2">过期时间（可选）<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>
          {publicationId ? <div className="publish-note stable"><ShieldCheck size={20} /><span><strong>原地址增量更新</strong><small>公开 URL 保持不变，内容版本会自动加一。</small></span></div> : <div className="publish-note"><ShieldCheck size={20} /><span><strong>创建安全公开地址</strong><small>Token 仅显示一次，请发布后立即复制。</small></span></div>}
          {published && <div className="published-result"><Rocket size={24} /><div><strong>{published.stable ? `订阅已更新至 v${published.version}` : `订阅 v${published.version} 已发布`}</strong>{publishedUrl ? <code>{publishedUrl}</code> : <small>原公开地址保持不变，可在已配置的客户端继续使用。</small>}</div>{publishedUrl && <button className="primary-button" onClick={() => navigator.clipboard?.writeText(publishedUrl).then(() => onMessage("订阅链接已复制"))}>复制链接</button>}</div>}
        </div>}

        <footer className="wizard-footer" data-guide-id={guideTargets.publishAction}><button className="secondary-button" disabled={step === 0 || busy} onClick={() => setStep((current) => current - 1)}><ChevronLeft size={16} />上一步</button>{step < steps.length - 1 ? <button className="primary-button" disabled={step === 0 && !selectedIds.size} onClick={() => setStep((current) => current + 1)}>下一步<ChevronRight size={16} /></button> : <div className="wizard-publish-actions"><button className="secondary-button" disabled={busy || errors.length > 0} onClick={() => void saveProfileOnly()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}仅保存方案</button><button className="primary-button" disabled={busy || errors.length > 0 || !selectedIds.size} onClick={() => void publish()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Rocket size={16} />}{publicationId ? "更新原链接" : "发布新订阅"}</button></div>}</footer>
      </div></section>

      <aside className="generator-summary"><div className="panel-card"><span className="eyebrow">LIVE SUMMARY</span><h3>生成摘要</h3><div className="summary-list"><span>节点数量<strong>{generatedConfig.proxies.length}</strong></span><span>策略组<strong>{generatedConfig.proxyGroups.length}</strong></span><span>启用规则<strong>{generatedConfig.rules.filter((rule) => rule.enabled).length}</strong></span><span>来源数量<strong>{selectedSourceIds.length}</strong></span><span>输出格式<strong>{targetFormat === "sing-box" ? "JSON" : "YAML"}</strong></span></div><div className={errors.length ? "validation-callout error" : "validation-callout"}><ShieldCheck size={17} /><span>{errors.length ? `有 ${errors.length} 个错误待修复` : "当前输出已通过结构校验"}</span></div>{profileId && <div className="profile-saved-state"><CheckCircle2 size={15} />正在编辑已保存方案</div>}</div></aside>
    </div>

    <ConfirmDialog open={!!deletingProfile} title="删除生成方案" message={`确定删除“${deletingProfile?.name}”吗？该方案下的公开订阅也会同时删除，原链接将立即失效。`} onClose={() => setDeletingProfile(null)} onConfirm={deleteProfile} />
  </div>;
}
