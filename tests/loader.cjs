// Compile isolated TypeScript services for Node's test runner, using application dependencies.
const Module=require('node:module');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const ts=require(path.join(root,'apps/backend/node_modules/typescript'));
const aliases=Object.entries(JSON.parse(fs.readFileSync(path.join(root,'apps/backend/tsconfig.json'),'utf8')).compilerOptions.paths).filter(([name])=>name.endsWith('/*')).map(([name,[target]])=>[name.slice(0,-1),path.resolve(root,'apps/backend',target.slice(0,-1))]);
const original=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){
    if(request==='@nodify/contract')request=path.join(root,'packages/nodify-contract/index.ts');
    for(const [prefix,dir] of aliases)if(request.startsWith(prefix)){request=path.join(dir,request.slice(prefix.length));break;}
    return original.call(this,request,parent,...rest);
};
require.extensions['.ts']=(module,filename)=>{const source=fs.readFileSync(filename,'utf8');const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}});module._compile(output.outputText,filename);};
module.exports={root};
