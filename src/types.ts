export interface Env {
	bucket: R2Bucket
	USERNAME: string
	PASSWORD: string
}

export type DavProperties = {
	creationdate: string | undefined
	displayname: string | undefined
	getcontentlanguage: string | undefined
	getcontentlength: string | undefined
	getcontenttype: string | undefined
	getetag: string | undefined
	getlastmodified: string | undefined
	resourcetype: string
	// macOS-specific properties
	lockdiscovery?: string
	supportedlock?: string
	quota?: string
	quotaused?: string
	executable?: string
}

export const DAV_CLASS = '1, 2, 3'
export const SUPPORT_METHODS = ['OPTIONS', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'GET', 'HEAD', 'PUT', 'DELETE', 'COPY', 'MOVE', 'LOCK', 'UNLOCK']
