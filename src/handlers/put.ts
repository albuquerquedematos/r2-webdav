import { make_resource_path, isMacOSSystemFile } from '../utils'

export async function handle_put(req: Request, bucket: R2Bucket): Promise<Response> {
	if (req.url.endsWith('/')) return new Response('Method Not Allowed', { status: 405 })

	let resource_path = make_resource_path(req)

	// Special handling for macOS system files
	if (isMacOSSystemFile(resource_path)) return new Response('', { status: 201 })

	// Check if the parent directory exists
	let dirpath = resource_path.split('/').slice(0, -1).join('/')
	if (dirpath !== '') {
		let dir = await bucket.head(dirpath)
		if (!(dir && dir.customMetadata?.resourcetype === '<collection />')) return new Response('Conflict', { status: 409 })
	}

	let body = await req.arrayBuffer()
	await bucket.put(resource_path, body, { onlyIf: req.headers, httpMetadata: req.headers })
	return new Response('', { status: 201 })
}

export async function handle_mkcol(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)

	// Check if the resource already exists
	let resource = await bucket.head(resource_path)
	if (resource !== null) return new Response('Method Not Allowed', { status: 405 })

	// Check if the parent directory exists
	let parent_dir = resource_path.split('/').slice(0, -1).join('/')
	if (parent_dir !== '' && !(await bucket.head(parent_dir))) return new Response('Conflict', { status: 409 })

	await bucket.put(resource_path, new Uint8Array(), { httpMetadata: req.headers, customMetadata: { resourcetype: '<collection />' } })

	return new Response('', { status: 201 })
}
