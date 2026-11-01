import { constants,openSync,closeSync,fstatSync,lstatSync,readSync } from 'node:fs'
import { resolve } from 'node:path'
export function parseActivationCliArgs(args:string[]) {
 const fileIndex=args.indexOf('--file'),fileName=args[fileIndex+1]
 const execute=args.includes('--execute'),confirm=args.includes('--confirm-external-verification')
 if(fileIndex!==0 || !fileName || !/^[a-zA-Z0-9_-]+\.json$/.test(fileName) || new Set(args).size!==args.length || args.length!==(execute?4:2) || execute!==confirm || args.slice(2).some(a=>!['--execute','--confirm-external-verification'].includes(a)))throw new Error('Invalid activation arguments')
 return {fileName,execute}
}
export function readPlatformActivationFile(fileName:string,root=process.cwd()):unknown {
 if(!/^[a-zA-Z0-9_-]+\.json$/.test(fileName))throw new Error('Private basename required')
 const dir=resolve(root,'.platform-activation'),directory=lstatSync(dir),uid=process.getuid?.()
 if(uid===undefined || directory.isSymbolicLink() || !directory.isDirectory() || directory.uid!==uid || (directory.mode&0o077)!==0)throw new Error('Private directory required')
 const fd=openSync(resolve(dir,fileName),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try {
  const stat=fstatSync(fd)
  if(!stat.isFile() || stat.uid!==uid || stat.nlink!==1 || (stat.mode&0o077)!==0 || stat.size>16384)throw new Error('Private bounded file required')
  const buffer=Buffer.alloc(16385),count=readSync(fd,buffer,0,buffer.length,0)
  if(count>16384)throw new Error('Activation file too large')
  return JSON.parse(buffer.subarray(0,count).toString('utf8'))
 } finally {closeSync(fd)}
}
