import { make_resource_path } from '../utils'
import { listAll } from '../r2-adapter'
import { handle_delete } from './delete'

export async function handle_copy(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)
	let dont_overwrite = req.headers.get('Overwrite') === 'F'
	let destination_header = req.headers.get('Destination')

	if (destination_header === null) return new Response('Bad Request', { status: 400 })

	let destination = new URL(destination_header).pathname.slice(1)
	destination = destination.endsWith('/') ? destination.slice(0, -1) : destination

	// Check if the parent directory exists
	let destination_parent = destination
		.split('/')
		.slice(0, destination.endsWith('/') ? -2 : -1)
		.join('/')

	if (destination_parent !== '' && !(await bucket.head(destination_parent))) return new Response('Conflict', { status: 409 })

	// Check if the destination already exists
	let destination_exists = await bucket.head(destination)
	if (dont_overwrite && destination_exists) return new Response('Precondition Failed', { status: 412 })

	let resource = await bucket.head(resource_path)
	if (resource === null) return new Response('Not Found', { status: 404 })

	let is_dir = resource?.customMetadata?.resourcetype === '<collection />'

	if (is_dir) return await handle_directory_copy(req, bucket, resource, resource_path, destination, destination_exists)
	else return await handle_file_copy(bucket, resource, destination, destination_exists)
}

async function handle_directory_copy(
	req: Request,
	bucket: R2Bucket,
	resource: R2Object,
	resource_path: string,
	destination: string,
	destination_exists: R2Object | null
): Promise<Response> {
	let depth = req.headers.get('Depth') ?? 'infinity'

	switch (depth) {
		case 'infinity': {
			let prefix = resource_path + '/'
			const copy = async (object: R2Object) => {
				let target = destination + '/' + object.key.slice(prefix.length)
				target = target.endsWith('/') ? target.slice(0, -1) : target
				let src = await bucket.get(object.key)
				if (src !== null) await bucket.put(target, src.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })
			}

			let promise_array = [copy(resource)]
			for await (let object of listAll(bucket, prefix, true)) promise_array.push(copy(object))
			await Promise.all(promise_array)

			return new Response(null, { status: destination_exists ? 204 : 201 })
		}

		case '0': {
			let object = await bucket.get(resource.key)
			if (object === null) return new Response('Not Found', { status: 404 })
			await bucket.put(destination, object.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })
			return new Response(null, { status: destination_exists ? 204 : 201 })
		}

		default: {
			return new Response('Bad Request', { status: 400 })
		}
	}
}

async function handle_file_copy(bucket: R2Bucket, resource: R2Object, destination: string, destination_exists: R2Object | null): Promise<Response> {
	let src = await bucket.get(resource.key)
	if (src === null) return new Response('Not Found', { status: 404 })
	await bucket.put(destination, src.body, { httpMetadata: src.httpMetadata, customMetadata: src.customMetadata })
	return new Response(null, { status: destination_exists ? 204 : 201 })
}

export async function handle_move(req: Request, bucket: R2Bucket): Promise<Response> {
	let resource_path = make_resource_path(req)
	let overwrite = req.headers.get('Overwrite') === 'T'
	let destination_header = req.headers.get('Destination')

	if (destination_header === null) return new Response('Bad Request', { status: 400 })

	let destination = new URL(destination_header).pathname.slice(1)
	destination = destination.endsWith('/') ? destination.slice(0, -1) : destination

	// Check if the parent directory exists
	let destination_parent = destination
		.split('/')
		.slice(0, destination.endsWith('/') ? -2 : -1)
		.join('/')

	if (destination_parent !== '' && !(await bucket.head(destination_parent))) return new Response('Conflict', { status: 409 })

	// Check if the destination already exists
	let destination_exists = await bucket.head(destination)
	if (!overwrite && destination_exists) return new Response('Precondition Failed', { status: 412 })

	let resource = await bucket.head(resource_path)
	if (resource === null) return new Response('Not Found', { status: 404 })
	if (resource.key === destination) return new Response('Bad Request', { status: 400 })

	// Delete the destination first if it exists
	if (destination_exists) await handle_delete(new Request(new URL(destination_header), req), bucket)

	// First copy, then delete the source
	const copyResult = await handle_copy(req, bucket)
	if (copyResult.status === 201 || copyResult.status === 204) await handle_delete(new Request(req.url, req), bucket)
	return copyResult
}
