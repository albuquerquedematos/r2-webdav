import { make_resource_path } from '../utils'

export async function handle_proppatch(req: Request, bucket: R2Bucket): Promise<Response> {
	const resource_path = make_resource_path(req)

	// Check if the resource exists
	let object = await bucket.head(resource_path)
	if (object === null) return new Response('Not Found', { status: 404 })

	// Read the request body
	const body = await req.text()

	// Use HTMLRewriter to parse XML
	const setProperties: { [key: string]: string } = {}
	const removeProperties: string[] = []
	let currentAction: 'set' | 'remove' | null = null
	let currentPropName: string | null = null
	let currentPropValue: string = ''

	class PropHandler {
		element(element: Element) {
			const tagName = element.tagName.toLowerCase()
			if (tagName === 'set') currentAction = 'set'
			else if (tagName === 'remove') currentAction = 'remove'
			else if (tagName === 'prop') {
				// Ignore <prop> tag
			} else {
				// Property name
				currentPropName = tagName
				currentPropValue = ''
			}
		}

		text(textChunk: Text) {
			if (currentPropName) currentPropValue += textChunk.text
		}

		end(e: Element) {
			if (currentAction === 'set' && currentPropName) setProperties[currentPropName] = currentPropValue.trim()
			else if (currentAction === 'remove' && currentPropName) removeProperties.push(currentPropName)
			currentPropName = null
			currentPropValue = ''
		}
	}

	// Use HTMLRewriter to parse the request body
	await new HTMLRewriter().on('propertyupdate', new PropHandler()).transform(new Response(body)).arrayBuffer()

	// Copy the original custom metadata
	const customMetadata = object.customMetadata ? { ...object.customMetadata } : {}

	// Update the metadata
	for (const propName in setProperties) customMetadata[propName] = setProperties[propName]
	for (const propName of removeProperties) delete customMetadata[propName]

	// Update the object's metadata
	const src = await bucket.get(object.key)
	if (src === null) return new Response('Not Found', { status: 404 })

	await bucket.put(object.key, src.body, { httpMetadata: object.httpMetadata, customMetadata: customMetadata })

	// Construct the response
	let responseXML = '<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">\n'

	for (const propName in setProperties) {
		responseXML += `
    <response>
        <href>/${object.key}</href>
        <propstat>
            <prop>
                <${propName} />
            </prop>
            <status>HTTP/1.1 200 OK</status>
        </propstat>
    </response>\n`
	}

	for (const propName of removeProperties) {
		responseXML += `
    <response>
        <href>/${object.key}</href>
        <propstat>
            <prop>
                <${propName} />
            </prop>
            <status>HTTP/1.1 200 OK</status>
        </propstat>
    </response>\n`
	}

	responseXML += '</multistatus>'
	return new Response(responseXML, { status: 207, headers: { 'Content-Type': 'application/xml; charset="utf-8"' } })
}
