import { make_resource_path, isMacOSSystemFile } from '../utils'

export async function handle_lock(req: Request, bucket: R2Bucket): Promise<Response> {
	// Get the resource path
	let resource_path = make_resource_path(req)

	// Read the lock request
	const body = await req.text()
	const lockToken = `urn:uuid:${crypto.randomUUID()}`

	// Check if the path exists
	let resourceExists = resource_path === '' || (await bucket.head(resource_path)) !== null

	// For non-existent resources, check parent permissions
	if (!resourceExists && !isMacOSSystemFile(resource_path)) {
		// Create minimal object to satisfy macOS permissions check
		if (resource_path) {
			const parentPath = resource_path.split('/').slice(0, -1).join('/')
			const parentExists = parentPath === '' || (await bucket.head(parentPath)) !== null

			// If parent exists, allow the lock
			if (parentExists) resourceExists = true
		}
	}

	// Status code: 200 if resource exists, 201 if we're creating a lock
	const statusCode = resourceExists ? 200 : 201

	// Generate proper lock response with timeout
	const response = `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>infinity</D:depth>
      <D:owner>
        <D:href>macOS Finder</D:href>
      </D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken>
        <D:href>${lockToken}</D:href>
      </D:locktoken>
      <D:lockroot>
        <D:href>/${resource_path}</D:href>
      </D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`

	return new Response(response, {
		status: statusCode,
		headers: { 'Content-Type': 'application/xml; charset="utf-8"', 'Lock-Token': `<${lockToken}>`, 'X-Apple-WebDAV-Compatibility': '1' },
	})
}

export async function handle_unlock(req: Request, bucket: R2Bucket): Promise<Response> {
	// We don't actually lock anything, so just return success
	return new Response(null, { status: 204 })
}
