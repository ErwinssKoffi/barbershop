/** Private draft fields. These are not automatically copied into the public projection. */
export interface ProfileDetails {
  slogan:string; category:string; publicAddress:string; whatsapp:string; publicEmail:string
  website:string; facebook:string; instagram:string; tiktok:string
}
export function emptyProfileDetails():ProfileDetails {
  return {slogan:'',category:'',publicAddress:'',whatsapp:'',publicEmail:'',website:'',facebook:'',instagram:'',tiktok:''}
}
export function parseProfileDetails(input:unknown):ProfileDetails {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid profile details')
  const row=input as Record<string,unknown>,keys=Object.keys(emptyProfileDetails())
  if(Object.keys(row).some(k=>!keys.includes(k))) throw new Error('Unknown profile detail')
  const text=(key:string,max:number)=>{
    const value=row[key]
    if(typeof value!=='string' || value.length>max || Array.from(value).some(c=>c.charCodeAt(0)<32 || c.charCodeAt(0)===127)) throw new Error('Invalid profile detail text')
    return value.trim()
  }
  const link=(key:string,hosts?:string[])=>{
    const value=text(key,2048)
    if(!value) return ''
    let url:URL
    try {url=new URL(value)} catch {throw new Error('Invalid public URL')}
    if(url.protocol!=='https:' || url.username || url.password || url.port || !/^https:\/\//i.test(value) || value.includes('\\') || /\s/.test(value) || (hosts && !hosts.includes(url.hostname))) throw new Error('Invalid public URL')
    return url.href
  }
  const whatsapp=text('whatsapp',80),publicEmail=text('publicEmail',254)
  if(whatsapp && !/^\+[1-9]\d{6,14}$/.test(whatsapp)) throw new Error('WhatsApp requires international format')
  if(publicEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(publicEmail)) throw new Error('Invalid public email')
  return {slogan:text('slogan',160),category:text('category',120),publicAddress:text('publicAddress',500),whatsapp,publicEmail,
    website:link('website'),facebook:link('facebook',['facebook.com','www.facebook.com']),instagram:link('instagram',['instagram.com','www.instagram.com']),tiktok:link('tiktok',['tiktok.com','www.tiktok.com'])}
}
