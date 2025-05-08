import { make_resource_path, isMacOSMetadataFile, createMacOSMetadataProperties, generate_propfind_response } from '../utils'
import { listAll } from '../r2-adapter'

export async function handle_propfind(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)

	// Special handling for macOS metadata files
	if (isMacOSMetadataFile(resource_path)) {
		const props = createMacOSMetadataProperties()
		const href = `/${resource_path}`

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
		page += generate_propfind_response(null)
		is_collection = true
	} else {
		let object = await bucket.head(resource_path)
		if (object === null) return new Response('Not Found', { status: 404 })
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
