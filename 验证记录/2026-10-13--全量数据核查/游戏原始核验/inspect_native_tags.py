"""Read-only static inspection of installed game's tag/cooking native methods.
Uses existing pefile and Visual Studio dumpbin; does not execute the game.
"""
import argparse, hashlib, json, struct, subprocess
from pathlib import Path
import pefile


def emit(path,data):
    with path.open('x',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,indent=2)


def inspect(args):
    metadata=args.game/'Touhou Mystia Izakaya_Data/il2cpp_data/Metadata/global-metadata.dat'
    assembly=args.game/'GameAssembly.dll'
    b=metadata.read_bytes(); h=struct.unpack_from('<64I',b)
    st=b[h[6]:h[6]+h[7]]
    def s(i): return st[i:st.index(b'\0',i)].decode() if i>=0 else ''
    methods=[struct.unpack_from('<5iI4H',b,h[12]+i*32) for i in range(h[13]//32)]
    fields=[struct.unpack_from('<3i',b,h[24]+i*12) for i in range(h[25]//12)]
    types=[]
    for i in range(h[41]//88):
        v=struct.unpack_from('<16i8H2I',b,h[40]+i*88)
        types.append((s(v[0]),s(v[1]),v))
    pe=pefile.PE(str(assembly)); image=assembly.read_bytes(); imagebase=pe.OPTIONAL_HEADER.ImageBase
    string_off=image.index(b'Assembly-CSharp.dll\0')
    string_va=imagebase+pe.get_rva_from_offset(string_off)
    p=image.index(struct.pack('<Q',string_va))
    module=struct.unpack_from('<12Q',image,p)
    method_count=module[1]; method_pointers=module[2]
    assert 10000 < method_count < 100000
    pointers=struct.unpack_from('<'+str(method_count)+'Q',image,pe.get_offset_from_rva(method_pointers-imagebase))
    boundaries={e.struct.BeginAddress:e.struct.EndAddress for e in pe.DIRECTORY_ENTRY_EXCEPTION}
    desired={
      'GameData.Core.Collections.Sellable':{'get_Tags','get_PriceTag','get_AdditiveTags','AddToTags','GetTagDiff','GetPopTag'},
      'GameData.Core.Collections.DataBaseCore':{'SolveTagPriority'},
      'NightScene.CookingUtility.CookController':{'GetFinalFood','SetCook','FinishCooking','CheckFailCook'},
      'NightScene.UI.CookingUtility.WorkSceneCookingSelectionPannel':{'UpdateOutputField'},
      'GameData.Core.Collections.Recipe':{'get_Ingredients'},
    }
    rows=[]; type_fields=[]
    for name,ns,v in types:
        full=ns+'.'+name
        if full in desired:
            type_fields.append({'type':full,'fields':[{'index':j,'name':s(fields[j][0]),'typeIndex':fields[j][1]} for j in range(v[8],v[8]+v[18])]})
        if ns.startswith(('GameData.Core','NightScene.Cooking','NightScene.UI.Cooking')):
            for j in range(v[9],v[9]+v[16]):
                m=methods[j]; token=m[5]; ix=(token&0xffffff)-1
                if not (0<=ix<len(pointers)): continue
                va=pointers[ix]; rva=va-imagebase
                row={'declaringType':full,'name':s(m[0]),'metadataMethodIndex':j,'token':hex(token),'methodPointerIndex':ix,'va':hex(va),'rva':hex(rva),'endRva':hex(boundaries[rva]) if rva in boundaries else None,'parameterCount':m[-1]}
                rows.append(row)
                if full in desired and row['name'] in desired[full]:
                    end=boundaries.get(rva,rva+1536)
                    assert end-rva<20000
                    raw=image[pe.get_offset_from_rva(rva):pe.get_offset_from_rva(rva)+(end-rva)]
                    row['nativeBytesSha256']=hashlib.sha256(raw).hexdigest()
                    file=args.out/('native_'+name+'_'+row['name']+'_'+str(j)+'.txt')
                    proc=subprocess.run([str(args.dumpbin),'/NOLOGO','/DISASM','/RANGE:'+hex(va)+','+hex(imagebase+end-1),str(assembly)],capture_output=True)
                    text=proc.stdout.decode('utf-8','replace')
                    with file.open('x',encoding='utf-8') as f: f.write(text)
                    row['disassemblyFile']=file.name
                    row['dumpbinExitCode']=proc.returncode
                    print('NATIVE',full,row['name'],row['va'],'SIZE',end-rva,'OUTPUT',file.name,flush=True)
    emit(args.out/'game_native_tag_method_index.json',{'source':str(assembly),'sha256':hashlib.sha256(image).hexdigest(),'metadata':str(metadata),'metadataSha256':hashlib.sha256(b).hexdigest(),'moduleNameVA':hex(string_va),'moduleVA':hex(imagebase+pe.get_rva_from_offset(p)),'moduleMethodCount':method_count,'fieldSchemas':type_fields,'methods':rows})

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--game',type=Path,required=True); ap.add_argument('--out',type=Path,required=True); ap.add_argument('--dumpbin',type=Path,required=True)
    inspect(ap.parse_args())
