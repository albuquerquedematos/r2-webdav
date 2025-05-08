export async function* listAll(bucket: R2Bucket, prefix: string, isRecursive: boolean = false) {
	let cursor: string | undefined = undefined
	do {
		var r2_objects = await bucket.list({
			prefix: prefix,
			delimiter: isRecursive ? undefined : '/',
			cursor: cursor,
			// @ts-ignore
			include: ['httpMetadata', 'customMetadata'],
		})

		for (let object of r2_objects.objects) yield object
		if (r2_objects.truncated) cursor = r2_objects.cursor
	} while (r2_objects.truncated)
}

export async function deleteAllInPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
	let r2_objects,
		cursor: string | undefined = undefined
	do {
		r2_objects = await bucket.list({ prefix: prefix, cursor: cursor })
		let keys = r2_objects.objects.map((object) => object.key)
		if (keys.length > 0) await bucket.delete(keys)
		if (r2_objects.truncated) cursor = r2_objects.cursor
	} while (r2_objects.truncated)
}
