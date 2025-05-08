import { make_resource_path, isMacOSSystemFile, log, logError } from '../utils'
import { listAll } from '../r2-adapter'

export async function handle_head(req: Request, bucket: R2Bucket): Promise<Response> {
	let response = await handle_get(req, bucket)
	return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
}

export async function handle_get(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)

	// Handle macOS metadata files
	if (isMacOSSystemFile(resource_path)) {
		return new Response(new Uint8Array(), {
			status: 200,
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': '0',
				'X-Apple-WebDAV-Compatibility': '1',
				'Accept-Ranges': 'bytes',
				'Last-Modified': new Date().toUTCString(),
				ETag: '"macOS-System-File"',
			},
		})
	}

	if (req.url.endsWith('/')) return await handle_directory_listing(req, bucket, resource_path)
	else return await handle_file_download(req, bucket, resource_path)
}

async function handle_directory_listing(req: Request, bucket: R2Bucket, resource_path: string): Promise<Response> {
	let page = '',
		prefix = resource_path
	if (resource_path !== '') {
		page += `<a href="../">..</a><br>`
		prefix = `${resource_path}/`
	}

	for await (const object of listAll(bucket, prefix)) {
		if (object.key === resource_path) continue
		let href = `/${object.key + (object.customMetadata?.resourcetype === '<collection />' ? '/' : '')}`
		page += `<a href="${href}">${object.httpMetadata?.contentDisposition ?? object.key.slice(prefix.length)}</a><br>`
	}

	// Template for directory listing
	var pageSource = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>R2Storage</title><style>*{box-sizing:border-box;}body{padding:10px;font-family:'Segoe UI','Circular','Roboto','Lato','Helvetica Neue','Arial Rounded MT Bold','sans-serif';}a{display:inline-block;width:100%;color:#000;text-decoration:none;padding:5px 10px;cursor:pointer;border-radius:5px;}a:hover{background-color:#60C590;color:white;}a[href="../"]{background-color:#cbd5e1;}</style></head><body><h1>R2 Storage</h1><div>${page}</div></body></html>`

	return new Response(pageSource, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Apple-WebDAV-Compatibility': '1', DAV: '1, 2, 3' } })
}

async function handle_file_download(req: Request, bucket: R2Bucket, resource_path: string): Promise<Response> {
	try {
		log(`[WebDAV GET] Starting file download for: ${resource_path}`)
		log(`[WebDAV GET] Request URL: ${req.url}`)
		log(`[WebDAV GET] Request headers:`, Object.fromEntries(req.headers.entries()))

		// First check if the file exists with a head request
		const fileExists = await bucket.head(resource_path)
		if (!fileExists) {
			log(`[WebDAV GET] File not found: ${resource_path}`)

			// Try to list files with similar names to help debug
			log(`[WebDAV GET] Listing files in bucket to check for similar names:`)
			const prefix = resource_path.split('/').slice(0, -1).join('/')
			for await (const object of listAll(bucket, prefix)) log(`[WebDAV GET] Found file in bucket: "${object.key}"`)

			return new Response('Not Found', { status: 404 })
		}
		log(`[WebDAV GET] File exists, size: ${fileExists.size}, etag: ${fileExists.etag}`)

			// Detect if this is a Finder request
		const isFinderRequest = req.headers.get('User-Agent')?.includes('WebDAVFS') || false
		log(`[WebDAV GET] Request from Finder: ${isFinderRequest}`)

		// Use range headers if present, otherwise get the full file
		const rangeHeader = req.headers.get('Range')
		log(`[WebDAV GET] Range header: ${rangeHeader || 'none'}`)

		let object
		try {
			if (rangeHeader) {
				log(`[WebDAV GET] Fetching with range: ${rangeHeader}`)
				object = await bucket.get(resource_path, { range: rangeHeader, onlyIf: req.headers })
			} else {
				log(`[WebDAV GET] Fetching entire file`)
				object = await bucket.get(resource_path, { onlyIf: req.headers })
			}
		} catch (fetchError: any) {
			logError(`[WebDAV GET] Error fetching from R2:`, fetchError)
			return new Response(`Error retrieving file: ${fetchError.message}`, { status: 500 })
		}

		if (object === null) {
			log(`[WebDAV GET] Object not found after HEAD check succeeded`)
			return new Response('Not Found', { status: 404 })
		}

		// Check if the object is an R2ObjectBody
		if ('body' in object === false) {
			log(`[WebDAV GET] Object has no body, type:`, typeof object)
			return new Response('No Content', { status: 204 })
		}

		// Log object properties
		log(`[WebDAV GET] Object retrieved:`, {
			key: object.key,
			size: object.size,
			etag: object.etag,
			range: object.range,
			httpMetadata: object.httpMetadata,
		})

		const filename = resource_path.split('/').pop() || 'file'
		const isPartial = rangeHeader && object.range

		let status = 200
		const headers: Record<string, string> = {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Length': object.size.toString(),
			'Accept-Ranges': 'bytes',
			'Last-Modified': object.uploaded.toUTCString(),
			ETag: object.etag || `"${resource_path}-${object.size}"`,
			'Cache-Control': 'no-cache',
			'X-Apple-WebDAV-Compatibility': '1',
			'X-WebDAV-Writable': 'true',
		}

		// For macOS Finder, use inline disposition instead of attachment
		if (isFinderRequest) {
			headers['Content-Disposition'] = `inline; filename="${filename}"`
		} else {
			headers['Content-Disposition'] = `attachment; filename="${filename}"`
		}

		// Handle range requests
		if (isPartial) {
			status = 206
			const range = object.range as any
			log(`[WebDAV GET] Processing partial response with range:`, range)

			if ('offset' in range && 'length' in range) {
				const offset = range.offset || 0
				const length = range.length || 0
				const end = offset + length - 1
				headers['Content-Range'] = `bytes ${offset}-${end}/${object.size}`
				headers['Content-Length'] = length.toString()
				log(`[WebDAV GET] Range parameters: offset=${offset}, length=${length}, end=${end}`)
			} else if ('suffix' in range) {
				const suffix = range.suffix || 0
				const offset = Math.max(0, object.size - suffix)
				const end = object.size - 1
				headers['Content-Range'] = `bytes ${offset}-${end}/${object.size}`
				headers['Content-Length'] = (end - offset + 1).toString()
				log(`[WebDAV GET] Suffix range: suffix=${suffix}, offset=${offset}, end=${end}`)
			} else {
				log(`[WebDAV GET] Unexpected range format:`, range)
			}
		}

		log(`[WebDAV GET] Returning response with status ${status} and headers:`, headers)

		// For macOS clients, explicitly stream the body without any transforms
		if (isFinderRequest && 'body' in object && object.body instanceof ReadableStream) {
			// Create a new Headers object from the record
			const responseHeaders = new Headers();
			for (const [key, value] of Object.entries(headers)) {
				responseHeaders.set(key, value);
			}
			
			return new Response(object.body, {
				status,
				headers: responseHeaders
			});
		}
		
		// For other clients or if not a ReadableStream
		return new Response('body' in object ? object.body : null, { status, headers })
	} catch (error: any) {
		logError(`[WebDAV GET] Unhandled error in file download:`, {
			error: error.message,
			stack: error.stack,
			resourcePath: resource_path,
			requestURL: req.url,
			requestMethod: req.method,
			headers: Object.fromEntries(req.headers.entries()),
		})
		return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain', 'X-Error-Detail': error.message || 'Unknown error' } })
	}
}
