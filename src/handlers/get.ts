import { make_resource_path, isMacOSSystemFile, calcContentRange } from '../utils'
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
			headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '0', 'X-Apple-WebDAV-Compatibility': '1', 'Accept-Ranges': 'bytes' },
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

	return new Response(pageSource, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function handle_file_download(req: Request, bucket: R2Bucket, resource_path: string): Promise<Response> {
	let object = await bucket.get(resource_path, { onlyIf: req.headers, range: req.headers })

	let isR2ObjectBody = (object: R2Object | R2ObjectBody): object is R2ObjectBody => {
		return 'body' in object
	}

	if (object === null) return new Response('Not Found', { status: 404 })
	else if (!isR2ObjectBody(object)) return new Response('Precondition Failed', { status: 412 })
	else {
		const { rangeOffset, rangeEnd } = calcContentRange(object)
		const contentLength = rangeEnd - rangeOffset + 1
		const filename = resource_path.split('/').pop() || 'file'

		return new Response(object.body, {
			status: object.range && contentLength !== object.size ? 206 : 200,
			headers: {
				'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
				'Content-Length': contentLength.toString(),
				'Content-Range': object.range ? `bytes ${rangeOffset}-${rangeEnd}/${object.size}` : '',
				'Content-Disposition': object.httpMetadata?.contentDisposition || `inline; filename="${filename}"`,
				'Accept-Ranges': 'bytes',
				'X-Apple-WebDAV-Compatibility': '1',
				...(object.httpMetadata?.contentEncoding ? { 'Content-Encoding': object.httpMetadata.contentEncoding } : {}),
				...(object.httpMetadata?.contentLanguage ? { 'Content-Language': object.httpMetadata.contentLanguage } : {}),
				...(object.httpMetadata?.cacheControl ? { 'Cache-Control': object.httpMetadata.cacheControl } : {}),
				ETag: object.etag,
				'Last-Modified': object.uploaded.toUTCString(),
			},
		})
	}
}
