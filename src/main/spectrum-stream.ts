/** Registry changes during pw-dump can append another JSON array to the snapshot. */
export function parsePipeWireDump(text: string): any[] {
  const objects = new Map<number, any>()
  let depth=0, start=-1, quoted=false, escaped=false
  for(let i=0;i<text.length;i++) {
    const c=text[i]
    if(quoted) { if(escaped) escaped=false; else if(c==='\\') escaped=true; else if(c==='"') quoted=false; continue }
    if(c==='"') { quoted=true; continue }
    if(c==='[') { if(depth===0) start=i; depth++ }
    else if(c===']') {
      if(--depth<0) throw new Error('Invalid PipeWire snapshot')
      if(depth===0) for(const value of JSON.parse(text.slice(start,i+1))) {
        if(!Number.isInteger(value.id)) continue
        if(value.info===null) objects.delete(value.id)
        else {
          const previous=value.type ? undefined : objects.get(value.id)
          objects.set(value.id,{...previous,...value,info:{...previous?.info,...value.info,props:{...previous?.info?.props,...value.info?.props}}})
        }
      }
    } else if(depth===0 && !/\s/.test(c)) throw new Error('Invalid PipeWire snapshot')
  }
  if(depth!==0 || quoted || start<0) throw new Error('Incomplete PipeWire snapshot')
  return [...objects.values()]
}
/** Match only an exact process owner and server object identity, never a title/name. */
export function ownPlaybackInput(inputs: any[], pid: number, objects: any[] = []): any | undefined {
  const direct = inputs.find(input => String(input.properties?.['application.process.id']) === String(pid))
  if (direct) return direct
  const clients = new Set(objects.filter(object => object.type === 'PipeWire:Interface:Client' && String(object.info?.props?.['application.process.id']) === String(pid)).map(object => String(object.id)))
  const nodes = objects.filter(object => {
    const props = object.info?.props
    return object.type === 'PipeWire:Interface:Node' && props?.['media.class'] === 'Stream/Output/Audio' && (String(props['application.process.id']) === String(pid) || clients.has(String(props['client.id'])))
  })
  return inputs.find(input => nodes.some(node => {
    const props = input.properties || {}, serial = node.info?.props?.['object.serial']
    // Require both identities: a recycled node ID must not select another stream.
    return props['object.id'] !== undefined && serial !== undefined && String(props['object.id']) === String(node.id) && String(props['object.serial']) === String(serial)
  }))
}
