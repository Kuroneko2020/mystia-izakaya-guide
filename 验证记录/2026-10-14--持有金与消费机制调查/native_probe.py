"""Read-only IL2CPP consumption investigation. Existing pefile + VS dumpbin only.
All persistent outputs use exclusive creation under --out; no game execution.
Metadata parsing and method-pointer lookup reused from 2026-10-13 inspect_native_tags.py.
"""
import argparse
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path
import pefile


def emit(p, data):
    with p.open('x', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load(game):
    meta = game / 'Touhou Mystia Izakaya_Data/il2cpp_data/Metadata/global-metadata.dat'
    dll = game / 'GameAssembly.dll'
    b = meta.read_bytes()
    h = struct.unpack_from('<64I', b)
    assert h[0] == 0xFAB11BAF and h[1] == 29
    st = b[h[6]:h[6]+h[7]]
    def s(i):
        return st[i:st.index(b'\0', i)].decode() if i >= 0 else ''
    mm = [struct.unpack_from('<5iI4H', b, h[12]+i*32) for i in range(h[13]//32)]
    ff = [struct.unpack_from('<3i', b, h[24]+i*12) for i in range(h[25]//12)]
    pp = [struct.unpack_from('<3i', b, h[22]+i*12) for i in range(h[23]//12)]
    tt = [struct.unpack_from('<16i8H2I', b, h[40]+i*88) for i in range(h[41]//88)]
    images = [struct.unpack_from('<10I', b, h[42]+i*40) for i in range(h[43]//40)]
    pe = pefile.PE(str(dll))
    image = dll.read_bytes()
    base = pe.OPTIONAL_HEADER.ImageBase
    boundaries = {x.struct.BeginAddress:x.struct.EndAddress for x in pe.DIRECTORY_ENTRY_EXCEPTION}
    modules = {}
    byval_to_definition = {v[2]:i for i,v in enumerate(tt)}
    def typename(i):
        v = tt[i]
        declaring = byval_to_definition.get(v[3])
        if declaring is not None and declaring != i:
            return typename(declaring)+'+'+s(v[0])
        return (s(v[1])+'.' if s(v[1]) else '')+s(v[0])
    rows = []
    types = []
    for im in images:
        name = s(im[0])
        if name not in ('Assembly-CSharp.dll','UnityEngine.CoreModule.dll','UnityEngine.UI.dll','Unity.TextMeshPro.dll','mscorlib.dll','System.Core.dll','System.dll'):
            continue
        try:
            so = image.index(name.encode()+b'\0')
            sva = base+pe.get_rva_from_offset(so)
            pos = image.index(struct.pack('<Q', sva))
            mod = struct.unpack_from('<12Q', image, pos)
            count, ptr = mod[1:3]
            assert count < 500000
            pointers = struct.unpack_from('<'+str(count)+'Q', image, pe.get_offset_from_rva(ptr-base))
            modules[name] = {'rva':hex(pe.get_rva_from_offset(pos)), 'count':count}
        except (ValueError, AssertionError, pefile.PEFormatError):
            continue
        for i in range(im[2], im[2]+im[3]):
            v = tt[i]
            full = typename(i)
            types.append({'index':i,'type':full,'image':name,'parentTypeIndex':v[4],'byvalTypeIndex':v[2], 'fields':[{'index':j,'name':s(ff[j][0]),'typeIndex':ff[j][1],'token':hex(ff[j][2] & 0xffffffff)} for j in range(v[8],v[8]+v[18])]})
            for j in range(v[9],v[9]+v[16]):
                m = mm[j]
                ix = (m[5] & 0xffffff)-1
                va = pointers[ix] if 0 <= ix < count else 0
                rva = va-base if va else 0
                rows.append({'declaringType':full,'typeIndex':i,'image':name,'name':s(m[0]),'metadataMethodIndex':j,'token':hex(m[5]),'methodPointerIndex':ix,'va':hex(va),'rva':hex(rva),'endRva':hex(boundaries[rva]) if rva in boundaries else None,'returnTypeIndex':m[2], 'parameters':[{'index':k,'name':s(pp[k][0]),'typeIndex':pp[k][2]} for k in range(m[3],m[3]+m[-1])]})
    return {'metadata':meta,'assembly':dll,'metadataBytes':b,'image':image,'pe':pe,'base':base,'boundaries':boundaries,'methods':rows,'types':types,'modules':modules}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--game',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--dumpbin',type=Path,required=True)
    ap.add_argument('--index',action='store_true')
    ap.add_argument('--methods',default='')
    ap.add_argument('--type',default='')
    ap.add_argument('--names',default='')
    ap.add_argument('--complete',action='store_true',help='Extend through next distinct native method; preserves initial evidence in separate files')
    args = ap.parse_args()
    assert args.out.is_dir()
    d = load(args.game)
    methods = d['methods']
    if args.index:
        manifest = args.game.parents[1]/'appmanifest_1584090.acf'
        old = args.out.parent/'2026-10-13--全量数据核查/游戏原始核验/game_catalog_raw_normalized.json'
        prior = json.loads(old.read_text(encoding='utf-8'))
        manifest_values = {}
        if manifest.exists():
            manifest_input = manifest.read_text(encoding='utf-8')
            for key in ('appid', 'name', 'buildid', 'installdir', 'StateFlags'):
                match = re.search(r'"'+re.escape(key)+r'"\s+"([^\"]*)"', manifest_input, re.IGNORECASE)
                if match:
                    manifest_values[key] = match.group(1)
        provenance = {'source':str(d['assembly']), 'assemblySha256':hashlib.sha256(d['image']).hexdigest(), 'assemblySize':len(d['image']), 'metadata':str(d['metadata']), 'metadataSha256':hashlib.sha256(d['metadataBytes']).hexdigest(), 'peImageBase':hex(d['base']), 'peTimeDateStamp':hex(d['pe'].FILE_HEADER.TimeDateStamp), 'existingCatalogBuild':prior.get('gameBuild'), 'existingCatalogVersion':prior.get('gameVersionResourceLastLine'), 'steamManifest':str(manifest), 'steamManifestFields':manifest_values, 'executionEvidence':'static inspection only; game not launched', 'modules':d['modules']}
        emit(args.out/'game_native_provenance.json',provenance)
        emit(args.out/'game_native_methods.json',methods)
        emit(args.out/'game_native_fields.json',d['types'])
    wanted = {int(x) for x in args.methods.split(',') if x}
    names = set(args.names.split(',')) if args.names else None
    selected = [r for r in methods if r['metadataMethodIndex'] in wanted or (args.type and re.search(args.type,r['declaringType']) and (not names or r['name'] in names))]
    byva = {}
    for r in methods:
        if int(r['va'],16):
            byva.setdefault(int(r['va'],16),[]).append(r)
    starts = sorted(byva)
    for r in selected:
        va = int(r['va'],16)
        rva = int(r['rva'],16)
        if not va:
            print('NO_POINTER',r['metadataMethodIndex'],r['declaringType'],r['name'])
            continue
        end = d['boundaries'].get(rva)
        if end is None or args.complete:
            end = next((a-d['base'] for a in starts if a>va),rva+256)
            end = min(end,rva+65536)
        file = args.out/('native_'+str(r['metadataMethodIndex'])+'_'+re.sub(r'[^\w.-]','_',r['declaringType'].split('.')[-1])+'_'+re.sub(r'[^\w.-]','_',r['name'])+('_complete' if args.complete else '')+'.txt')
        if file.exists():
            print('EXISTS_SKIP',file.name)
            continue
        p = subprocess.run([str(args.dumpbin),'/NOLOGO','/DISASM','/RANGE:'+hex(va)+','+hex(d['base']+end-1),str(d['assembly'])],capture_output=True)
        text = p.stdout.decode('utf-8','replace')
        def annotate(m):
            target = int(m.group(2),16)
            rr = byva.get(target,[])
            return m.group(0)+(' ; '+ ' | '.join(x['declaringType']+'::'+x['name']+' [MI '+str(x['metadataMethodIndex'])+', RVA '+x['rva']+']' for x in rr[:12]) if rr else '')
        text = re.sub(r'\b(call|jmp)\s+(?:0x)?([0-9A-Fa-f]{12,16})\b',annotate,text)
        prefix = '# '+r['declaringType']+'::'+r['name']+'\n# '+json.dumps(r,ensure_ascii=False)+'\n# range end RVA '+hex(end)+'; dumpbin exit '+str(p.returncode)+'\n'
        with file.open('x',encoding='utf-8') as f:
            f.write(prefix+text)
        print('DUMP',r['metadataMethodIndex'],r['declaringType'],r['name'],r['rva'],'SIZE',end-rva,file.name)


if __name__=='__main__':
    main()
