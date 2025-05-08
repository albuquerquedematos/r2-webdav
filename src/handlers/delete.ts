import { make_resource_path } from '../utils'
import { deleteAllInPrefix } from '../r2-adapter'

export async function handle_delete(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)

	if (resource_path === '') {
		await deleteAllInPrefix(bucket, '')
		return new Response(null, { status: 204 })
	}

	let resource = await bucket.head(resource_path)
	if (resource === null) return new Response('Not Found', { status: 404 })

	await bucket.delete(resource_path)

	if (resource.customMetadata?.resourcetype !== '<collection />') return new Response(null, { status: 204 })

	await deleteAllInPrefix(bucket, resource_path + '/')
	return new Response(null, { status: 204 })
}
