import cors from 'koa-cors';
import Koa from 'koa';
import type {AbsolutePath, Analyzer} from '@lit-labs/analyzer';

export const startServer = async (analyzer: Analyzer, port?: number) => {
  const app = new Koa();
  app.use(cors({origin: '*', credentials: true}));
  app.use(async (context) => {
    if (context.path.startsWith('/_src/')) {
      const modulePath = context.path.slice('/_src'.length) as AbsolutePath;
      const module = analyzer.getModule(modulePath);
      context.body = `<!doctype html>
        <html>
          <body>
            <pre>
              modulePath: ${modulePath}
              module: ${!!module}
            </pre>
          </body>
        </html>`;
      context.type = 'text/html';
      return;
    }
    context.body = 'Hello World';
  });
  const server = app.listen(port ?? 3334);
  console.log(server.address());
  return server;
};
