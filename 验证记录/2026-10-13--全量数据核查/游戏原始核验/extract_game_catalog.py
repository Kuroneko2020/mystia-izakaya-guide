"""Read-only local Unity catalog probe; no game execution or dependencies installed.
All output filenames are exclusive-create; existing evidence is never overwritten.
"""
from pathlib import Path
import argparse, base64, hashlib, json, struct, sys, time
import UnityPy
import lz4.block


def emit(path, value):
    with path.open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_bundle(path):
    raw = path.read_bytes()
    if raw[:8] != b'UnityFS\0':
        key = raw[0] ^ ord('U')
        raw = raw.translate(bytes.maketrans(bytes(range(256)), bytes(i ^ key for i in range(256))))
    if raw[:8] != b'UnityFS\0':
        raise ValueError('Unknown envelope')
    p = 12
    for _ in range(2):
        p = raw.index(b'\0', p) + 1
    length, compressed, uncompressed, flags = struct.unpack_from('>QIII', raw, p)
    assert length == len(raw)
    start = (p+20+15) & ~15
    blockinfo = raw[start:start+compressed]
    if flags & 63 in (2, 3):
        blockinfo = lz4.block.decompress(blockinfo, uncompressed_size=uncompressed)
    elif flags & 63 != 0:
        raise ValueError('Unexpected compression')
    nb = struct.unpack_from('>I', blockinfo, 16)[0]
    assert nb < 100000
    blocks = [struct.unpack_from('>IIH', blockinfo, 20+10*i) for i in range(nb)]
    q = 20+10*nb
    nn = struct.unpack_from('>I', blockinfo, q)[0]; q += 4
    nodes = []
    for _ in range(nn):
        off, size, fl = struct.unpack_from('>QQI', blockinfo, q); q += 20
        end = blockinfo.index(b'\0', q)
        name = blockinfo[q:end].decode(); q = end+1
        nodes.append((off,size,fl,name))
    pos = start+compressed
    if flags & 512: pos = (pos+15)&~15
    chunks = []
    for u,c,f in blocks:
        data = raw[pos:pos+c]; pos += c
        if f & 63 in (2,3): data=lz4.block.decompress(data, uncompressed_size=u)
        elif f & 63 != 0: raise ValueError('Unexpected block compression')
        assert len(data)==u
        chunks.append(data)
    assert pos==len(raw)
    data=b''.join(chunks)
    envs=[]
    for off,size,fl,name in nodes:
        if fl == 4:
            envs.append((name,UnityPy.load(data[off:off+size])))
    return envs


def catalog(game):
    path=game/'Touhou Mystia Izakaya_Data/StreamingAssets/aa/catalog.bundle'
    env=UnityPy.load(str(path))
    d=json.loads(next(o.read().m_Script for o in env.objects if o.type.name=='TextAsset'))
    eb=base64.b64decode(d['m_EntryDataString'])
    bb=base64.b64decode(d['m_BucketDataString'])
    entries=[struct.unpack_from('<7i',eb,4+28*i) for i in range(struct.unpack_from('<i',eb)[0])]
    buckets=[]; p=4
    for _ in range(struct.unpack_from('<i',bb)[0]):
        off,n=struct.unpack_from('<2i',bb,p); p+=8
        ix=struct.unpack_from('<'+str(n)+'i',bb,p); p+=4*n
        buckets.append(ix)
    return d,entries,buckets


def metadata(game):
    path=game/'Touhou Mystia Izakaya_Data/il2cpp_data/Metadata/global-metadata.dat'
    b=path.read_bytes(); h=struct.unpack_from('<64I',b)
    assert h[0]==0xFAB11BAF and h[1]==29
    strings=b[h[6]:h[6]+h[7]]
    def s(i): return strings[i:strings.index(b'\0',i)].decode('utf-8') if i>=0 else ''
    fields=[struct.unpack_from('<3i',b,h[24]+i*12) for i in range(h[25]//12)]
    types=[]
    for i in range(h[41]//88):
        v=struct.unpack_from('<16i8H2I',b,h[40]+i*88)
        types.append({'index':i,'name':s(v[0]),'namespace':s(v[1]),'byvalTypeIndex':v[2],'parentTypeIndex':v[4],'flags':v[7],
        'fieldStart':v[8],'methodStart':v[9],'methodCount':v[16],'fieldCount':v[18],
        'fields':[{'index':j,'name':s(fields[j][0]),'typeIndex':fields[j][1],'token':fields[j][2]} for j in range(v[8],v[8]+v[18])],
        'raw':v})
    return types


def extract_languages(args):
    d,entries,buckets=catalog(args.game)
    suffixes=('FoodsLang.txt','FoodTagsLang.txt','IngredientsLang.txt','IngredientsLang_2.txt','BeveragesLang.txt','BeveragesLang_2.txt','BeverageTagsLang.txt','CookersLang.txt','StandardCookersLang.txt','NormGuestLang.txt','SpecGuestLang.txt','SpecFoodTagLang.txt','SpecBevTagLang.txt')
    assets={}; deps=set()
    for e in entries:
        name=d['m_InternalIds'][e[0]]
        if 'Language_Chinese' in name and name.endswith(suffixes):
            names=[d['m_InternalIds'][entries[k][0]].replace('\\','/').split('/')[-1] for k in buckets[e[2]]]
            assets[name]=names; deps.update(names)
    emit(args.out/'language_asset_dependencies.json',assets)
    print('LANGUAGE ASSETS',len(assets),'BUNDLES',len(deps),flush=True)
    names={Path(name).stem for name in assets}
    rows=[]
    base=args.game/'Touhou Mystia Izakaya_Data/StreamingAssets/aa/StandaloneWindows64'
    for filename in sorted(deps):
        path=base/filename
        row={'source':str(path),'sha256':sha256(path),'texts':[]}
        for cab,env in load_bundle(path):
            for obj in env.objects:
                if obj.type.name=='TextAsset':
                    data=obj.read()
                    if data.m_Name in names:
                        text=data.m_Script
                        row['texts'].append({'name':data.m_Name,'text':text,'cab':cab,'path_id':obj.path_id})
                        print('LANG',data.m_Name,'LEN',len(text),'PREFIX',repr(text[:200]),flush=True)
        if row['texts']: rows.append(row)
    emit(args.out/'game_chinese_language_texts.json',rows)


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--game',type=Path,required=True); ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--probe',action='store_true'); ap.add_argument('--stage',choices=['probe','languages'],default='probe'); args=ap.parse_args()
    if args.stage=='languages':
        extract_languages(args)
        return
    d,entries,buckets=catalog(args.game)
    wanted=('FoodProfile.asset','RecipeProfile.asset','IngredientProfile.asset','BeverageProfile.asset','FoodTagProfile.asset','FoodTagRuleProfile.asset','BeverageTagProfile.asset','CookerProfile.asset','NormalGuestProfile.asset','SpecialGuestProfile.asset','LanguageProfile.asset')
    assets={}; deps=set()
    for e in entries:
        s=d['m_InternalIds'][e[0]]
        if any(s.endswith(t) for t in wanted):
            ix=buckets[e[2]] if e[2]>=0 else []
            names=[d['m_InternalIds'][entries[k][0]].replace('\\','/').split('/')[-1] for k in ix]
            assets[s]=names; deps.update(names)
    emit(args.out/'catalog_asset_dependencies.json',assets)
    mt=metadata(args.game)
    terms=('Food','Recipe','Ingredient','Beverage','Guest','Language','TagRule','IZKYAES','Cooker','Sellable','Item','ValueTuple')
    selected=[t for t in mt if any(x.lower() in t['name'].lower() for x in terms)]
    emit(args.out/'metadata_relevant_types.json',selected)
    print('CATALOG assets',len(assets),'dependency bundles',len(deps),flush=True)
    base=args.game/'Touhou Mystia Izakaya_Data/StreamingAssets/aa/StandaloneWindows64'
    rows=[]
    for n,name in enumerate(sorted(deps)):
        path=base/name
        try:
            envs=load_bundle(path)
            row={'path':str(path),'sha256':sha256(path),'size':path.stat().st_size,'objects':[]}
            for cab,env in envs:
                for o in env.objects:
                    if o.type.name=='MonoBehaviour':
                        z=o.parse_monobehaviour_head()
                        if any(x.lower() in z.m_Name.lower() for x in terms):
                            row['objects'].append({'cab':cab,'path_id':o.path_id,'name':z.m_Name,'bytes':o.byte_size,'script_file':z.m_Script.m_FileID,'script_path_id':z.m_Script.m_PathID,'has_typetree':bool(o.serialized_type and o.serialized_type.node),'raw_prefix_hex':o.get_raw_data()[:160].hex()})
                    elif o.type.name=='MonoScript':
                        z=o.read()
                        if any(x.lower() in z.m_Name.lower() for x in terms):
                            row['objects'].append({'cab':cab,'path_id':o.path_id,'type':'MonoScript','name':z.m_Name,'class':z.m_ClassName,'namespace':z.m_Namespace})
            rows.append(row)
            print(n+1,len(deps),name,'MATCHES',len(row['objects']),[(r['name'],r.get('bytes')) for r in row['objects'][:25]],flush=True)
        except Exception as ex:
            rows.append({'path':str(path),'error':repr(ex)})
            print('ERROR',name,repr(ex),flush=True)
    emit(args.out/'bundle_probe.json',rows)
    print('DONE',flush=True)

if __name__=='__main__': main()
