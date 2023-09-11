import cors from 'koa-cors';
import type {AbsolutePath, Analyzer} from '@lit-labs/analyzer';
import {createPackageAnalyzer} from '@lit-labs/analyzer/package-analyzer.js';
import type {DevServer} from './types.cjs';
import {createRequire} from 'module';
import type {Server} from 'http';

const require = createRequire(import.meta.url);

import vscode = require('vscode');
import wds = require('@web/dev-server');
import {startServer} from './server.js';
import {AddressInfo} from 'net';

const {startDevServer} = wds;

// Map of workspace folder to dev server and analyzer
const workspaceResourcesCache = new Map<
  string,
  {server: DevServer; analyzer: Analyzer; server2: Server}
>();

const getWorkspaceResources = async (
  workspaceFolder: vscode.WorkspaceFolder
) => {
  let workspaceResources = workspaceResourcesCache.get(
    workspaceFolder.uri.fsPath
  );
  if (workspaceResources === undefined) {
    const server = await startDevServer({
      config: {
        rootDir: workspaceFolder!.uri.fsPath,
        nodeResolve: {
          exportConditions: ['development', 'browser'],
          extensions: ['.cjs', '.mjs', '.js'],
          dedupe: () => true,
          preferBuiltins: false,
        },
        port: 3333,
        middleware: [cors({origin: '*', credentials: true})],
      },
      readCliArgs: false,
      readFileConfig: false,
    });

    const analyzer = createPackageAnalyzer(
      workspaceFolder!.uri.fsPath as AbsolutePath
    );

    const server2 = await startServer(analyzer);
    workspaceResources = {server, analyzer, server2};
    workspaceResourcesCache.set(workspaceFolder.uri.fsPath, workspaceResources);
  }
  return workspaceResources;
};

export class LitModuleEditorProvider
  implements vscode.CustomTextEditorProvider
{
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new LitModuleEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      LitModuleEditorProvider.viewType,
      provider
    );
    return providerRegistration;
  }

  private static readonly viewType = 'ignition.lit-module-editor';

  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    };
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

    const {server, analyzer, server2} = await getWorkspaceResources(
      workspaceFolder!
    );

    webviewPanel.webview.html = this.getHtmlForWebview(
      document,
      workspaceFolder,
      analyzer,
      server,
      server2
    );
  }

  private getHtmlForWebview(
    document: vscode.TextDocument,
    workspaceFolder: vscode.WorkspaceFolder | undefined,
    analyzer: Analyzer,
    server: DevServer,
    server2: Server
  ): string {
    const modulePath = document.uri.fsPath;
    const module = analyzer.getModule(modulePath as AbsolutePath);
    const elements = module.getCustomElementExports();
    const {hostname, port} = server.config;
    const scriptUrl = `http://${hostname}:${port}/${module.jsPath}`;

    const server2Address = server2.address() as AddressInfo;

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <script type="module" src="${scriptUrl}"></script>
          <style>
            .element-container {
              width: 640px;
            }
          </style>
        </head>
        <body>
          <h1>Lit Editor</h1>
          <pre>
            server: ${server.config.rootDir}
            workspaceFolder: ${workspaceFolder?.uri}
            fileName: ${document.fileName}
            jsPath: ${module.jsPath}
            scriptUrl: ${scriptUrl}
            elements: ${elements.map((e) => e.tagname)}
            server2: ${server2Address.address}:${server2Address.port}
          </pre>
          <main>
            ${elements
              .map(
                (e) => `<section class="element-container">
              <h2>&lt;${e.tagname}&gt;</h2>
              <${e.tagname}></${e.tagname}></section>`
              )
              .join('')}
          </main>
        </body>
      </html>
    `;
  }
}
