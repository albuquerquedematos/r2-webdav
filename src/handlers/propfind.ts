import { make_resource_path, isMacOSMetadataFile, createMacOSMetadataProperties, generate_propfind_response, log } from '../utils'
import { listAll } from '../r2-adapter'

export async function handle_propfind(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)
	log(`[WebDAV PROPFIND] Handling PROPFIND for path: "${resource_path}"`)

	// Special handling for macOS metadata files
	if (isMacOSMetadataFile(resource_path)) {
		log(`[WebDAV PROPFIND] Handling as macOS metadata file: ${resource_path}`)
		const props = createMacOSMetadataProperties()
		const href = `/${encodeURIComponent(resource_path)}`

		// Return a response that makes macOS happy
		const response = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>${href}</href>
    <propstat>
      <prop>
      ${Object.entries(props)
				.filter(([_, value]) => value !== undefined)
				.map(([key, value]) => `<${key}>${value}</${key}>`)
				.join('\n        ')}
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`

		return new Response(response, { status: 207, headers: { 'Content-Type': 'text/xml', 'X-Apple-WebDAV-Compatibility': '1' } })
	}

	// Original PROPFIND code
	let is_collection: boolean
	let page = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">`

	if (resource_path === '') {
		log(`[WebDAV PROPFIND] Handling root directory`)
		page += generate_propfind_response(null)
		is_collection = true
	} else {
		let object = await bucket.head(resource_path)
		if (object === null) {
			log(`[WebDAV PROPFIND] Resource not found: ${resource_path}`)

			// List available files to debug
			log(`[WebDAV PROPFIND] Available files in same directory:`)
			const prefix = resource_path.split('/').slice(0, -1).join('/')
			for await (const obj of listAll(bucket, prefix)) log(`[WebDAV PROPFIND] - ${obj.key}`)

			return new Response('Not Found', { status: 404 })
		}
		log(`[WebDAV PROPFIND] Resource found: ${resource_path}, isCollection: ${object.customMetadata?.resourcetype === '<collection />'}`)
		is_collection = object.customMetadata?.resourcetype === '<collection />'
		page += generate_propfind_response(object)
	}

	if (is_collection) {
		let depth = req.headers.get('Depth') ?? 'infinity'
		switch (depth) {
			case '0':
				break
			case '1':
				{
					let prefix = resource_path === '' ? resource_path : resource_path + '/'
					for await (let object of listAll(bucket, prefix)) page += generate_propfind_response(object)
				}
				break
			case 'infinity':
				{
					let prefix = resource_path === '' ? resource_path : resource_path + '/'
					for await (let object of listAll(bucket, prefix, true)) page += generate_propfind_response(object)
				}
				break
			default:
				return new Response('Forbidden', { status: 403 })
		}
	}

	page += '\n</multistatus>\n'
	return new Response(page, { status: 207, headers: { 'Content-Type': 'text/xml', 'X-Apple-WebDAV-Compatibility': '1' } })
}
