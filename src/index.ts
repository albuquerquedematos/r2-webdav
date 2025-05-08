import { Env, SUPPORT_METHODS, DAV_CLASS } from './types'
import { is_authorized, handle_options } from './utils'

// Import handlers
import {
	handle_get,
	handle_head,
	handle_put,
	handle_mkcol,
	handle_propfind,
	handle_proppatch,
	handle_delete,
	handle_copy,
	handle_move,
	handle_lock,
	handle_unlock,
} from './handlers'

async function dispatch_handler(req: Request, bucket: R2Bucket): Promise<Response> {
	//prettier-ignore
	switch (req.method) {
		case 'OPTIONS':   return       handle_options(req)
		case 'HEAD':      return await handle_head(req, bucket)
		case 'GET':       return await handle_get(req, bucket)
		case 'PUT':       return await handle_put(req, bucket)
		case 'DELETE':    return await handle_delete(req, bucket)
		case 'MKCOL':     return await handle_mkcol(req, bucket)
		case 'PROPFIND':  return await handle_propfind(req, bucket)
		case 'PROPPATCH': return await handle_proppatch(req, bucket)
		case 'COPY':      return await handle_copy(req, bucket)
		case 'MOVE':      return await handle_move(req, bucket)
		case 'LOCK':      return await handle_lock(req, bucket)
		case 'UNLOCK':    return await handle_unlock(req, bucket)
		default:
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { Allow: SUPPORT_METHODS.join(', '), DAV: DAV_CLASS, 'X-Apple-WebDAV-Compatibility': '1' },
			})
	}
}

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { bucket } = env

		// Allow all OPTIONS requests without auth for better macOS compatibility
		if (req.method === 'OPTIONS') return handle_options(req)

		if (!is_authorized(req.headers.get('Authorization') ?? '', env.USERNAME, env.PASSWORD)) {
			return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="webdav"', 'X-Apple-WebDAV-Compatibility': '1' } })
		}

		let response: Response = await dispatch_handler(req, bucket)

		// Set CORS headers
		response.headers.set('Access-Control-Allow-Origin', req.headers.get('Origin') ?? '*')
		response.headers.set('Access-Control-Allow-Methods', SUPPORT_METHODS.join(', '))
		response.headers.set(
			'Access-Control-Allow-Headers',
			['authorization', 'content-type', 'depth', 'overwrite', 'destination', 'range', 'if', 'lock-token', 'timeout', 'translate'].join(', ')
		)
		response.headers.set(
			'Access-Control-Expose-Headers',
			['content-type', 'content-length', 'dav', 'etag', 'last-modified', 'location', 'date', 'content-range', 'lock-token'].join(', ')
		)
		response.headers.set('Access-Control-Allow-Credentials', 'false')
		response.headers.set('Access-Control-Max-Age', '86400')

		// Add macOS WebDAV compatibility headers
		response.headers.set('X-Apple-WebDAV-Compatibility', '1')
		response.headers.set('X-WebDAV-Writable', 'true')

		// Add MS Office compatibility headers
		response.headers.set('MS-Author-Via', 'DAV')

		return response
	},
}
