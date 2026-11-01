import { beforeEach,afterEach,expect,it } from 'vitest'
import { chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseActivationCliArgs,readPlatformActivationFile } from '../../server/platformActivationFiles'
import { parsePlatformActivation } from '../../server/platformActivation'
let root:string
beforeEach(()=>{mkdirSync('.cache',{recursive:true});root=mkdtempSync(resolve('.cache/platform-files-'));mkdirSync(resolve(root,'.platform-activation'),{mode:0o700})})
afterEach(()=>rmSync(root,{recursive:true,force:true}))
it('aperçu par défaut ; activation nécessite les deux confirmations CLI',()=>{
 expect(parseActivationCliArgs(['--file','intent.json'])).toEqual({fileName:'intent.json',execute:false})
 expect(parseActivationCliArgs(['--file','intent.json','--execute','--confirm-external-verification']).execute).toBe(true)
 for(const args of [[],['--file','../intent.json'],['--file','intent.json','--execute'],['--file','intent.json','--confirm-external-verification'],['--file','intent.json','--force']])expect(()=>parseActivationCliArgs(args)).toThrow()
})
it('fichier privé borné seulement, symlink et permissions ouvertes refusés',()=>{
 const file=resolve(root,'.platform-activation','intent.json');writeFileSync(file,'{}',{mode:0o600})
 expect(readPlatformActivationFile('intent.json',root)).toEqual({})
 chmodSync(file,0o644);expect(()=>readPlatformActivationFile('intent.json',root)).toThrow(/Private/)
 chmodSync(file,0o600);symlinkSync(file,resolve(root,'.platform-activation','link.json'));expect(()=>readPlatformActivationFile('link.json',root)).toThrow()
 writeFileSync(file,'x'.repeat(16385));expect(()=>readPlatformActivationFile('intent.json',root)).toThrow(/bounded/)
})
it('répertoire non privé et chemins arbitraires refusés',()=>{
 chmodSync(resolve(root,'.platform-activation'),0o755)
 expect(()=>readPlatformActivationFile('intent.json',root)).toThrow(/Private directory/)
 expect(()=>readPlatformActivationFile('/tmp/intent.json',root)).toThrow(/basename/)
})
it('commande canonique stricte et aucun acteur ou prix arbitraire accepté',()=>{
 const input={activationKey:crypto.randomUUID(),tenantId:crypto.randomUUID(),billingAnchorAt:'2027-01-31T10:00:00.000Z',periodIndex:0,evidenceNamespace:'verified-bank',externalReference:'external-ref',evidenceReference:'case-ref',verificationReason:'Checked externally',verifiedAmountXof:4900,externalVerificationConfirmed:true}
 expect(parsePlatformActivation(input)).toEqual(input)
 for(const change of [{operatorReference:'forged'},{verifiedAmountXof:1},{externalVerificationConfirmed:'true'},{periodIndex:-1},{billingAnchorAt:'2027-02-30T10:00:00.000Z'},{evidenceReference:'https://private.invalid/token'},{verificationReason:''},{evidenceNamespace:'../bank'}])expect(()=>parsePlatformActivation({...input,...change})).toThrow()
})
