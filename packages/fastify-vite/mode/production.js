const { parse, resolve, join, exists } = require('../ioutils')
const FastifyStatic = require('@fastify/static')

function fileUrl(str) {
  if (typeof str !== 'string') {
    throw new Error('Expected a string')
  }

  let pathName = resolve(str).replace(/\\/g, '/')

  // Windows drive letter must be prefixed with a slash
  if (pathName[0] !== '/') {
    pathName = `/${pathName}`
  }

  return encodeURI(`file://${pathName}`)
}

async function setup(config) {
  if (!config.bundle) {
    config.bundle = {
      dir: join(config.vite.root, config.vite.build.outDir),
    }
  }
  // For production you get the distribution version of the render function
  const { assetsDir } = config.vite.build

  const clientDist = config.spa
    ? resolve(config.bundle.dir)
    : resolve(config.bundle.dir, 'client')

  if (!exists(clientDist)) {
    throw new Error('No client distribution bundle found.')
  }

  const serverDist = resolve(config.bundle.dir, 'server')
  if (!config.spa && !exists(serverDist)) {
    throw new Error('No server distribution bundle found.')
  }
  // We also register fastify-static to serve all static files
  // in production (dev server takes of this)
  await this.scope.register(async function staticContext(scope) {
    await scope.register(FastifyStatic, {
      root: [resolve(clientDist, assetsDir), resolve(serverDist, assetsDir)],
      prefix: `/${assetsDir}`,
    })
  })
  // Note: this is just to ensure it works, for a real world
  // production deployment, you'll want to capture those paths in
  // Nginx or just serve them from a CDN instead

  config.hasRenderFunction = typeof config.createRenderFunction === 'function'

  // Load routes from client module (server entry point)
  const clientModule = await loadClient()
  const client = await config.prepareClient(clientModule, this.scope, config)

  // Set reply.html() function with production version of index.html
  this.scope.decorateReply(
    'html',
    await config.createHtmlFunction(
      config.bundle.indexHtml,
      this.scope,
      config,
    ),
  )

  if (config.hasRenderFunction) {
    // Set reply.render() function with the client module production bundle
    const renderFunction = await config.createRenderFunction(
      client,
      this.scope,
      config,
    )
    this.scope.decorateReply('render', renderFunction)
  }

  return { client, routes: client.routes }

  // Loads the Vite application server entry point for the client
  async function loadClient() {
    if (config.spa) {
      return {}
    }
    const serverFiles = [
      join('server', `${parse(config.clientModule).name}.js`),
      join('server', `${parse(config.clientModule).name}.mjs`),
    ]
    let serverBundlePath
    for (const serverFile of serverFiles) {
      // Use file path on Windows
      serverBundlePath =
        process.platform === 'win32'
          ? new URL(fileUrl(resolve(config.bundle.dir, serverFile)))
          : resolve(config.bundle.dir, serverFile)
      if (await exists(serverBundlePath)) {
        break
      }
    }
    let serverBundle = await import(serverBundlePath)
    if (typeof serverBundle.default === 'function') {
      serverBundle = await serverBundle.default(config)
    }
    return serverBundle.default || serverBundle
  }
}

module.exports = setup
