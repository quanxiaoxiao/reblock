# Zod Validation Rule

Each endpoint requires schema:

createXSchema
updateXSchema
getXByIdSchema

Schema shape:

{
  body?,
  params?,
  query?
}

Validation middleware stores result in:

c.get('validated')
