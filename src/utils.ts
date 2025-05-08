import { DavProperties, SUPPORT_METHODS, DAV_CLASS } from './types'

// New logging utility functions
export function log(message: string, data?: any): void {
	const env = (globalThis as any).LOGGING || 'false'
	if (env === 'true') {
		if (data) console.log(message, data)
		else console.log(message)
	}
}

export function logError(message: string, error?: any): void {
	const env = (globalThis as any).LOGGING || 'false'
	if (env === 'true') {
		if (error) console.error(message, error)
		else console.error(message)
	}
}

export function make_resource_path(req: Request): string {
	// Get the path from the URL and remove the leading slash
	let path = new URL(req.url).pathname.slice(1)

	// Decode URL-encoded characters (like %20 for spaces)
	path = decodeURIComponent(path)

	// Remove trailing slash if present
	path = path.endsWith('/') ? path.slice(0, -1) : path

	console.log(`[WebDAV] Resource path decoded from "${new URL(req.url).pathname}" to "${path}"`)
	return path
}

export function is_authorized(authorization_header: string, username: string, password: string): boolean {
	const encoder = new TextEncoder()
	const header = encoder.encode(authorization_header)
	const expected = encoder.encode(`Basic ${btoa(`${username}:${password}`)}`)
	return header.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(header, expected)
}

// Helper function to check if a path is a macOS system file
export function isMacOSSystemFile(path: string): boolean {
	return (
		isMacOSMetadataFile(path) ||
		path.includes('.DS_Store') ||
		path === '.DS_Store' ||
		path.endsWith('.Trashes') ||
		path.includes('.TemporaryItems') ||
		path.includes('.fseventsd')
	)
}

// Helper function to check if a path is a macOS metadata file
export function isMacOSMetadataFile(path: string): boolean {
	return path.includes('/._') || path === '._' || path.startsWith('._')
}

// Helper function to create minimal properties for macOS metadata files
export function createMacOSMetadataProperties(): DavProperties {
	return {
		creationdate: new Date().toUTCString(),
		displayname: undefined,
		getcontentlanguage: undefined,
		getcontentlength: '0',
		getcontenttype: 'application/octet-stream',
		getetag: '"macOSResourceFork"',
		getlastmodified: new Date().toUTCString(),
		resourcetype: '',
		lockdiscovery: '',
		supportedlock: '<lockentry><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockentry>',
	}
}

export function fromR2Object(object: R2Object | null | undefined): DavProperties {
	if (object === null || object === undefined) {
		return {
			creationdate: new Date().toUTCString(),
			displayname: undefined,
			getcontentlanguage: undefined,
			getcontentlength: '0',
			getcontenttype: undefined,
			getetag: '"directory-root"',
			getlastmodified: new Date().toUTCString(),
			resourcetype: '<collection />',
			lockdiscovery: '',
			supportedlock: '<lockentry><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockentry>',
			quota: '0',
			quotaused: '0',
			executable: 'T',
		}
	}

	const isDir = object.customMetadata?.resourcetype === '<collection />'

	return {
		creationdate: object.uploaded.toUTCString(),
		displayname: object.httpMetadata?.contentDisposition || object.key.split('/').pop(),
		getcontentlanguage: object.httpMetadata?.contentLanguage,
		getcontentlength: object.size.toString(),
		getcontenttype: isDir ? 'httpd/unix-directory' : (object.httpMetadata?.contentType ?? 'application/octet-stream'),
		getetag: object.etag || `"${object.key}-${object.size}"`,
		getlastmodified: object.uploaded.toUTCString(),
		resourcetype: object.customMetadata?.resourcetype ?? '',
		lockdiscovery: '',
		supportedlock: '<lockentry><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockentry>',
		quota: isDir ? '0' : undefined,
		quotaused: isDir ? '0' : undefined,
		executable: isDir ? 'T' : 'F',
	}
}

export function calcContentRange(object: R2ObjectBody) {
	let rangeOffset = 0
	let rangeEnd = object.size - 1

	if (object.range) {
		if ('suffix' in object.range) {
			// Case 3: {suffix: number}
			rangeOffset = Math.max(0, object.size - object.range.suffix)
		} else {
			// Case 1: {offset: number, length?: number}
			// Case 2: {offset?: number, length: number}
			rangeOffset = object.range.offset ?? 0
			const length = object.range.length ?? object.size - rangeOffset
			rangeEnd = Math.min(rangeOffset + length - 1, object.size - 1)
		}
	}

	// Ensure valid values
	rangeOffset = Math.max(0, rangeOffset)
	rangeEnd = Math.min(rangeEnd, object.size - 1)

	return { rangeOffset, rangeEnd, contentLength: rangeEnd - rangeOffset + 1 }
}

export function handle_options(req: Request): Response {
	return new Response(null, {
		status: 200,
		headers: {
			Allow: SUPPORT_METHODS.join(', '),
			DAV: DAV_CLASS,
			'MS-Author-Via': 'DAV',
			'X-Apple-WebDAV-Compatibility': '1',
			'X-WebDAV-Writable': 'true',
			'X-Finder-WebDAV-Interoperability': 'accept-ranges,resource-fork',
			'Content-Length': '0',
		},
	})
}

export function generate_propfind_response(object: R2Object | null): string {
	if (object === null) {
		return `
  <response>
    <href>/</href>
    <propstat>
      <prop>
      ${Object.entries(fromR2Object(null))
				.filter(([_, value]) => value !== undefined)
				.map(([key, value]) => `<${key}>${value}</${key}>`)
				.join('\n          ')}
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`
	}

	// Properly encode the href to handle special characters
	let href = `/${object.key + (object.customMetadata?.resourcetype === '<collection />' ? '/' : '')}`

	// Ensure proper URL encoding for href elements in XML
	// Keep slashes intact but encode other special characters
	href = href
		.split('/')
		.map((segment) => (segment ? encodeURIComponent(segment) : ''))
		.join('/')

	return `
  <response>
    <href>${href}</href>
    <propstat>
      <prop>
      ${Object.entries(fromR2Object(object))
				.filter(([_, value]) => value !== undefined)
				.map(([key, value]) => `<${key}>${value}</${key}>`)
				.join('\n          ')}
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`
}
