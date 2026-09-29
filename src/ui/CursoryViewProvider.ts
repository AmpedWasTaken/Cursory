import * as vscode from "vscode";
import type {
  CursoryStatus,
  DashboardState,
  ExtensionToWebviewMessage,
  SidebarView,
  WebviewToExtensionMessage,
} from "./models.js";
import type { StatsStore } from "./StatsStore.js";
import { readSettings, updateSetting } from "./ExtensionSettings.js";

export const CURSORY_VIEW_ID = "cursory.sidebar";

interface ProviderActions {
  setEnabled(enabled: boolean): Promise<void>;
  resetSession(): Promise<void>;
  resetLifetime(): Promise<void>;
  clearHistory(): Promise<void>;
  clearCache(): Promise<void>;
  completeOnboarding(): Promise<void>;
}

export class CursoryViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private currentView: SidebarView;
  private selectedRequestId?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: StatsStore,
    private readonly actions: ProviderActions,
    private readonly getStatus: () => CursoryStatus,
    private readonly onboardingComplete: () => boolean,
  ) {
    this.currentView = onboardingComplete() ? "overview" : "welcome";
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.handleMessage(message);
    });
  }

  show(view: SidebarView = "overview", requestId?: string): void {
    this.currentView = view;
    this.selectedRequestId = requestId;
    void vscode.commands.executeCommand(`${CURSORY_VIEW_ID}.focus`);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const message: ExtensionToWebviewMessage = {
      type: "state:update",
      payload: this.state(),
    };
    await this.view.webview.postMessage(message);
  }

  private state(): DashboardState {
    return {
      view: this.currentView,
      status: this.getStatus(),
      stats: this.store.snapshot(),
      settings: readSettings(),
      selectedRequestId: this.selectedRequestId,
      onboardingComplete: this.onboardingComplete(),
    };
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.refresh();
        return;
      case "navigate":
        this.currentView = message.view;
        this.selectedRequestId = message.requestId;
        await this.refresh();
        return;
      case "settings:update":
        await updateSetting(message.key, message.value);
        await this.refresh();
        return;
      case "command":
        if (message.command === "enable") {
          await this.actions.setEnabled(true);
          await this.actions.completeOnboarding();
          this.currentView = "overview";
        } else if (message.command === "resetSession") {
          await this.actions.resetSession();
        } else if (message.command === "resetLifetime") {
          await this.actions.resetLifetime();
        } else if (message.command === "clearHistory") {
          await this.actions.clearHistory();
        } else {
          await this.actions.clearCache();
        }
        await this.refresh();
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const initial = JSON.stringify(this.state()).replaceAll("<", "\\u003c");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Cursory</title>
<style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:12px/1.45 var(--vscode-font-family);overflow-wrap:anywhere}button,input,select{font:inherit;color:inherit}.app{padding:12px}.header{display:flex;align-items:center;gap:8px;margin-bottom:12px}.title{font-size:14px;font-weight:600;flex:1}.icon-button,.link-button,.history-item{border:0;background:transparent;color:inherit;cursor:pointer}.icon-button{padding:3px 5px;border-radius:4px}.icon-button:hover,.history-item:hover{background:var(--vscode-list-hoverBackground)}button:focus-visible,input:focus-visible,select:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}.status{display:flex;align-items:center;gap:6px;color:var(--vscode-descriptionForeground);font-size:11px}.dot{width:7px;height:7px;border-radius:50%;border:1px solid currentColor}.dot.active{border:0;background:var(--vscode-testing-iconPassed,var(--vscode-charts-green))}.dot.optimizing{border-right-color:transparent}.dot.error{color:var(--vscode-errorForeground)}.hero{padding:10px 0 12px}.hero-value{font-size:27px;line-height:1.05;font-weight:600;letter-spacing:-.4px}.muted{color:var(--vscode-descriptionForeground)}.meta{font-size:11px}.section{border-top:1px solid var(--vscode-widget-border,var(--vscode-border));padding-top:12px;margin-top:4px;margin-bottom:12px}.section-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:8px}.row{display:flex;justify-content:space-between;gap:12px;padding:2px 0}.row strong{font-weight:500;font-variant-numeric:tabular-nums}.metric{font-variant-numeric:tabular-nums}.saved{color:var(--vscode-testing-iconPassed,var(--vscode-charts-green));font-weight:600}.comparison{margin:9px 0}.bar-row{display:grid;grid-template-columns:48px 1fr 38px;align-items:center;gap:6px;margin:5px 0;font-size:11px}.bar-track{height:5px;background:var(--vscode-progressBar-background);opacity:.35}.bar{height:100%;background:var(--vscode-foreground);opacity:.55}.bar.optimized{background:var(--vscode-testing-iconPassed,var(--vscode-charts-green));opacity:.9}.button{border:1px solid var(--vscode-button-border,transparent);border-radius:4px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:4px 9px;cursor:pointer}.button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.button:hover{background:var(--vscode-button-secondaryHoverBackground)}.button.primary:hover{background:var(--vscode-button-hoverBackground)}.history{display:flex;flex-direction:column}.history-item{display:grid;grid-template-columns:34px 1fr auto;gap:6px;text-align:left;padding:5px 3px;border-radius:3px}.history-item .preview{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history-item .amount{color:var(--vscode-descriptionForeground);font-size:11px}.back{padding:0;margin:0 0 12px;color:var(--vscode-textLink-foreground);cursor:pointer}.request-title{font-weight:500;margin-bottom:10px}.file{padding:4px 0;font-family:var(--vscode-editor-font-family);font-size:11px}.detail-box{border:1px solid var(--vscode-widget-border,var(--vscode-border));border-radius:5px;padding:8px;margin:8px 0}details>summary{cursor:pointer;color:var(--vscode-foreground);padding:3px 0}.settings-section{margin-bottom:16px}.setting{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:5px 0}.setting-desc{grid-column:1/-1;color:var(--vscode-descriptionForeground);font-size:11px;margin-top:-4px}.setting input[type=number],.setting select{width:92px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:3px 5px}.setting input[type=checkbox]{accent-color:var(--vscode-checkbox-selectBackground,var(--vscode-button-background))}.danger{color:var(--vscode-errorForeground)}.empty{text-align:center;padding:26px 8px;color:var(--vscode-descriptionForeground)}.empty strong{display:block;color:var(--vscode-foreground);margin-bottom:6px}.welcome{padding:18px 3px}.welcome h1{font-size:19px;margin:0 0 3px}.welcome .tagline{font-size:14px;margin-bottom:16px}.welcome .button{margin-top:14px}.pill{display:inline-block;border:1px solid var(--vscode-widget-border,var(--vscode-border));border-radius:9px;padding:0 6px;font-size:10px;color:var(--vscode-descriptionForeground)}.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
</style>
</head>
<body><main id="app" class="app"></main>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let state=${initial};
const app=document.getElementById("app");
const esc=(value)=>String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=(n)=>n<1000?Math.round(n).toString():n<1000000?(n/1000).toFixed(n<10000?1:0)+"K":(n/1000000).toFixed(1)+"M";
const pc=(n)=>Math.round(n*10)/10;
const row=(label,value,cls="")=>'<div class="row"><span class="muted">'+esc(label)+'</span><strong class="'+cls+'">'+esc(value)+'</strong></div>';
const nav=(view,label,extra="")=>'<button class="link-button '+extra+'" data-view="'+view+'">'+label+'</button>';
function header(){const s=state.status;const label=s.charAt(0).toUpperCase()+s.slice(1);return '<div class="header"><div class="title">Cursory</div><div class="status"><span class="dot '+s+'"></span>'+esc(label)+'</div><button class="icon-button" data-view="settings" aria-label="Open Cursory settings">⚙</button></div>'}
function bars(r){const max=Math.max(1,r.baselineTokens);return '<div class="comparison"><div class="bar-row"><span>Baseline</span><div class="bar-track"><div class="bar" style="width:100%"></div></div><span>'+fmt(r.baselineTokens)+'</span></div><div class="bar-row"><span>Cursory</span><div class="bar-track"><div class="bar optimized" style="width:'+Math.min(100,r.optimizedTokens/max*100)+'%"></div></div><span>'+fmt(r.optimizedTokens)+'</span></div></div>'}
function breakdown(r){return '<details><summary>What did Cursory remove?</summary><div class="detail-box">'+row("Duplicate context",fmt(r.duplicateTokensRemoved))+row("Irrelevant context",fmt(r.irrelevantTokensRemoved))+row("Compression savings",fmt(r.compressionSavings))+'</div></details>'}
function overview(){const stats=state.stats.session;const last=state.stats.history[0];let html=header();if(!last){return html+'<div class="empty"><strong>Cursory is active</strong>Send a request in Cursor and your context savings will appear here.<br><br>No statistics are estimated or invented.</div>'+advanced()}html+='<div class="hero"><div class="hero-value">'+fmt(stats.tokensSaved)+'</div><div>tokens saved</div><div class="muted">'+pc(stats.reductionPercent)+'% less context this session</div></div>';html+='<section class="section"><div class="section-title">Last request</div>';if(last.bypassed){html+='<strong>No optimization needed</strong><p class="muted">'+esc(last.bypassReason||"Cursory left the original context untouched.")+'</p>'}else{html+='<div class="metric">'+fmt(last.baselineTokens)+' → '+fmt(last.optimizedTokens)+'</div><div class="saved">'+fmt(last.tokensSaved)+' saved · '+pc(last.reductionPercent)+'%</div>'+bars(last)+breakdown(last)}html+='<div class="actions"><button class="button" data-view="request" data-id="'+esc(last.id)+'">Details</button></div></section>';html+='<section class="section"><div class="section-title">Session</div>'+row("Requests optimized",stats.requestsOptimized)+row("Tokens saved",fmt(stats.tokensSaved),"saved")+row("Average reduction",pc(stats.reductionPercent)+"%")+row("Duplicates removed",fmt(stats.duplicateTokensRemoved))+'</section>';html+='<section class="section"><div class="section-title">Recent</div><div class="history">'+state.stats.history.slice(0,20).map((r)=>'<button class="history-item" data-view="request" data-id="'+esc(r.id)+'"><span>'+(r.bypassed?"—":Math.round(r.reductionPercent)+"%")+'</span><span class="preview">'+esc(r.promptPreview||"Untitled request")+'</span><span class="amount">'+(r.bypassed?"bypassed":fmt(r.tokensSaved)+" saved")+'</span></button>').join("")+'</div></section>';html+='<section class="section"><div class="section-title">Lifetime</div>'+row("Tokens saved",fmt(state.stats.lifetime.tokensSaved))+row("Requests optimized",state.stats.lifetime.requestsOptimized)+row("Average reduction",pc(state.stats.lifetime.reductionPercent)+"%")+'</section>'+advanced();return html}
function advanced(){return '<section class="section"><div class="section-title">Advanced</div><div class="actions">'+nav("inspector","Context Inspector","button")+(state.settings.debugEnabled?nav("inspector","Debug","button"):"")+'</div></section>'}
function selected(){return state.stats.history.find((r)=>r.id===state.selectedRequestId)||state.stats.history[0]}
function request(){const r=selected();if(!r)return header()+back()+"<div class=empty>No request data available.</div>";let html=header()+back()+'<div class="section-title">Request</div><div class="request-title">“'+esc(r.promptPreview)+'”</div><section class="section"><div class="section-title">Optimization</div>'+row("Baseline tokens",fmt(r.baselineTokens))+row("Final tokens",fmt(r.optimizedTokens))+row("Saved",fmt(r.tokensSaved),"saved")+row("Reduction",pc(r.reductionPercent)+"%");if(r.regressionRejected)html+='<div class="detail-box"><strong>Optimization rejected</strong>'+row("Attempted",fmt(r.attemptedOptimizedTokens||0))+row("Original used",fmt(r.baselineTokens))+'<div class="muted">Regression protection kept the original context.</div></div>';else if(r.bypassed)html+='<p class="muted">No optimization needed. '+esc(r.bypassReason||"Original context was preserved.")+'</p>';html+='</section><section class="section"><div class="section-title">Context used</div>'+row("Current prompt",fmt(r.contextBreakdown.currentPrompt))+row("Recent conversation",fmt(r.contextBreakdown.recentConversation))+row("Historical summary",fmt(r.contextBreakdown.historicalSummary))+row("Project context",fmt(r.contextBreakdown.projectContext))+row("Cursory overhead",fmt(r.contextBreakdown.instructions))+row("Metadata",fmt(r.contextBreakdown.metadata))+'</section><section class="section"><div class="section-title">Removed</div>'+row("Duplicates",fmt(r.duplicateTokensRemoved))+row("Irrelevant context",fmt(r.irrelevantTokensRemoved))+row("Compression savings",fmt(r.compressionSavings))+'</section><section class="section"><div class="section-title">Relevant files</div>'+(r.relevantFiles.length?r.relevantFiles.map((f)=>'<div class="file">'+esc(f.path)+'</div>').join(""):'<span class="muted">No file attribution recorded.</span>')+'<div class="actions"><button class="button" data-view="inspector" data-id="'+esc(r.id)+'">Inspect context</button></div></section>';return html}
function inspector(){const r=selected();let html=header()+back()+'<div class="section-title">Developer · Context Inspector</div>';if(!r)return html+'<div class="empty">No optimization data to inspect yet.</div>';const b=r.contextBreakdown;const total=Object.values(b).reduce((a,n)=>a+n,0);html+='<div class="hero"><div class="hero-value">'+fmt(total)+'</div><div>final context tokens</div></div><section class="section">'+row("Current prompt",fmt(b.currentPrompt))+row("Recent conversation",fmt(b.recentConversation))+row("Historical summary",fmt(b.historicalSummary))+row("Project context",fmt(b.projectContext))+row("Cursory instructions",fmt(b.instructions))+row("Metadata",fmt(b.metadata))+'</section>';if(r.contextBlocks?.length){html+='<section class="section"><div class="section-title">Context blocks</div>'+r.contextBlocks.map((x)=>'<details class="detail-box"><summary>'+esc(x.label)+' · '+fmt(x.tokens)+'</summary>'+row("Source",x.source)+row("Relevance",x.relevance==null?"—":x.relevance.toFixed(2))+row("Cached",x.cached?"Yes":"No")+'<div class="meta muted">'+x.reasons.map(esc).join("<br>")+'</div>'+(state.settings.storeDebugContext&&x.content?'<pre>'+esc(x.content)+'</pre>':'')+'</details>').join("")+'</section>'}if(r.duplicateBlocks?.length){html+='<section class="section"><div class="section-title">Duplicates removed</div>'+r.duplicateBlocks.map((x)=>'<div class="detail-box">'+row("Source",x.source)+row("Matched",x.matched)+row("Similarity",pc(x.similarity*100)+"%")+row("Tokens avoided",fmt(x.tokensAvoided))+'</div>').join("")+'</section>'}if(state.settings.debugEnabled&&r.pipeline){const p=r.pipeline;html+='<section class="section"><div class="section-title">Pipeline</div>'+row("Selection",p.selectionMs+"ms")+row("Deduplication",p.deduplicationMs+"ms")+row("Compression",p.compressionMs+"ms")+row("Budgeting",p.budgetingMs+"ms")+row("Total",p.totalMs+"ms")+row("Candidates",p.candidates)+row("Selected",p.selected)+row("Dropped",p.dropped)+'</section>'}return html}
function toggle(key,label,desc=""){return '<label class="setting"><span>'+label+'</span><input type="checkbox" data-setting="'+key+'" '+(state.settings[key]?"checked":"")+'>'+(desc?'<span class="setting-desc">'+desc+'</span>':'')+'</label>'}
function number(key,label){return '<label class="setting"><span>'+label+'</span><input type="number" min="0" data-setting="'+key+'" value="'+state.settings[key]+'"></label>'}
function settings(){let html=header()+back()+'<div class="settings-section"><div class="section-title">General</div>'+toggle("enabled","Enable Cursory")+'<label class="setting"><span>Optimization mode</span><select data-setting="mode"><option value="conservative">Conservative</option><option value="balanced">Balanced · Recommended</option><option value="aggressive">Aggressive</option></select><span class="setting-desc">Balanced removes redundant and low-value context while preserving relevant work.</span></label><label class="setting"><span>Status bar</span><select data-setting="statusBarDisplay"><option value="name">Cursory</option><option value="percent">Cursory · 32%</option><option value="saved">Cursory · 3.4K</option><option value="hidden">Hidden</option></select></label></div><details class="settings-section"><summary class="section-title">Token budget · Advanced</summary>'+number("maxContextTokens","Max Cursory context")+number("recentConversationTokens","Recent conversation")+number("historicalSummaryTokens","Historical summary")+number("projectContextTokens","Project context")+number("overheadTokens","Cursory overhead")+'</details><div class="settings-section"><div class="section-title">Context</div>'+toggle("removeDuplicates","Remove duplicate context")+toggle("compressConversation","Compress old conversation")+toggle("skipIrrelevant","Skip irrelevant messages")+toggle("optimizeFiles","Optimize file context")+toggle("reuseSummaries","Reuse cached summaries")+toggle("noNegativeSavings","No-op when savings are negative","If optimization would increase context usage, the original request is left untouched.")+'</div><div class="settings-section"><div class="section-title">File context</div>'+toggle("preferOpenFiles","Prefer current/open files")+toggle("useDependencies","Use dependency relationships")+toggle("includeSmallFiles","Include entire small files")+number("largeFileThreshold","Large file threshold (lines)")+number("maxFiles","Max files per request")+'</div><div class="settings-section"><div class="section-title">Privacy</div><p class="muted">Cursory's deterministic context processing and statistics are local. No analytics or source code are sent to Cursory servers. Full debug context is not stored unless explicitly enabled.</p>'+toggle("storeDebugContext","Store full debug context","Developer feature. May retain source and prompts in local extension storage.")+'</div><div class="settings-section"><div class="section-title">Debug</div>'+toggle("debugEnabled","Enable developer/debug mode")+'</div><div class="settings-section"><div class="section-title">Data</div><div class="actions"><button class="button" data-command="resetSession">Reset session stats</button><button class="button" data-command="resetLifetime">Reset lifetime stats</button><button class="button" data-command="clearCache">Clear summary cache</button><button class="button" data-command="clearHistory">Clear request history</button></div></div>';setTimeout(()=>{document.querySelectorAll("select[data-setting]").forEach((el)=>{el.value=String(state.settings[el.dataset.setting])})});return html}
function welcome(){return '<div class="welcome"><h1>Cursory</h1><div class="tagline">Use less context.<br>Keep the useful parts.</div><p class="muted">Cursory automatically removes duplicate, irrelevant, and oversized context before supported Cursor requests.</p><label class="setting"><span>Optimization</span><select data-setting="mode"><option value="conservative">Conservative</option><option value="balanced" selected>Balanced</option><option value="aggressive">Aggressive</option></select></label><label class="setting"><span>Show savings in status bar</span><input type="checkbox" data-onboarding-status '+(state.settings.statusBarDisplay==="hidden"?"":"checked")+'></label><button class="button primary" data-command="enable">Enable Cursory</button><p class="meta muted">No account required.</p></div>'}
function back(){return '<button class="link-button back" data-view="overview">← Overview</button>'}
function render(){if(state.view==="welcome"&&!state.onboardingComplete)app.innerHTML=welcome();else if(state.view==="request")app.innerHTML=request();else if(state.view==="inspector")app.innerHTML=inspector();else if(state.view==="settings")app.innerHTML=settings();else app.innerHTML=overview()}
app.addEventListener("click",(e)=>{const target=e.target.closest("[data-view],[data-command]");if(!target)return;if(target.dataset.view)vscode.postMessage({type:"navigate",view:target.dataset.view,requestId:target.dataset.id});else if(target.dataset.command){const destructive=["resetSession","resetLifetime","clearHistory","clearCache"].includes(target.dataset.command);if(!destructive||confirm("Continue with this Cursory action?"))vscode.postMessage({type:"command",command:target.dataset.command})}});
app.addEventListener("change",(e)=>{const target=e.target;if(target.dataset.onboardingStatus!==undefined){vscode.postMessage({type:"settings:update",key:"statusBarDisplay",value:target.checked?"percent":"hidden"});return}if(!target.dataset.setting)return;let value=target.type==="checkbox"?target.checked:target.type==="number"?Number(target.value):target.value;vscode.postMessage({type:"settings:update",key:target.dataset.setting,value})});
window.addEventListener("message",(event)=>{if(event.data.type==="state:update"){state=event.data.payload;render()}});
render();vscode.postMessage({type:"ready"});
</script></body></html>`;
  }
}
