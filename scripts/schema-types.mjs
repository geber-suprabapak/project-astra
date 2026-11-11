export function typeOfSchema(schema) {
  if (schema.allOf) return schema.allOf.map(typeOfSchema).join(' & ')
  if (schema.anyOf) return [...new Set(schema.anyOf.map(typeOfSchema))].join(' | ')
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  if (Array.isArray(schema.type))
    return schema.type.map((type) => typeOfSchema({ ...schema, type })).join(' | ')
  switch (schema.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `(${typeOfSchema(schema.items ?? {})})[]`
    case 'object':
      return schema.properties
        ? `{ ${Object.entries(schema.properties)
            .map(
              ([key, value]) =>
                `${JSON.stringify(key)}${schema.required?.includes(key) ? '' : '?'}: ${typeOfSchema(value)}`,
            )
            .join('; ')} }`
        : 'Record<string, unknown>'
    default:
      return 'unknown'
  }
}
