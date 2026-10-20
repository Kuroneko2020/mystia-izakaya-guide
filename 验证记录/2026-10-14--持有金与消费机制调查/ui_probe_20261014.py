"""Read-only UI investigation with existing py/pefile and VS dumpbin.
No imports of game code; no game execution. All output files are exclusive ui_ creations.
Shared index is read-only. Pass game/dumpbin paths; no workspace root is hardcoded.
"""
import argparse
import bisect
import hashlib
import json
import re
import struct
import subprocess
from pathlib import Path
import pefile


def exclusive(path, value):
    with path.open('x', encoding='utf-8') as f:
        if isinstance(value, str):
            f.write(value)
        else:
            json.dump(value, f, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--game', type=Path, required=True)
    ap.add_argument('--dumpbin', type=Path)
    ap.add_argument('--index', type=Path)
    ap.add_argument('--out', type=Path, default=Path(__file__).parent)
    ap.add_argument('--dump', default='')
    ap.add_argument('--xref', default='')
    ap.add_argument('--fields', default='')
    ap.add_argument('--refs-from', default='')
    ap.add_argument('--vtables', default='')
    ap.add_argument('--suffix', default='01')
    args = ap.parse_args()
    index = args.index or args.out/'game_native_methods_v2.json'
    rows = json.loads(index.read_text(encoding='utf-8'))
    bymi = {x['metadataMethodIndex']:x for x in rows}
    byva = {}
    for r in rows:
        if int(r['va'], 16):
            byva.setdefault(int(r['va'], 16), []).append(r)
    dll = args.game/'GameAssembly.dll'
    raw = dll.read_bytes()
    pe = pefile.PE(str(dll))
    base = pe.OPTIONAL_HEADER.ImageBase
    boundaries = {x.struct.BeginAddress:x.struct.EndAddress for x in pe.DIRECTORY_ENTRY_EXCEPTION}
    function_starts = sorted(boundaries)
    def off(va):
        return pe.get_offset_from_rva(va-base)
    def owner(va):
        rva = va-base
        i = bisect.bisect_right(function_starts, rva)-1
        if i>=0 and rva<boundaries[function_starts[i]]:
            return function_starts[i]+base
        return None
    def label(va):
        rr = byva.get(va, [])
        return ' | '.join(x['declaringType']+'::'+x['name']+' [MI '+str(x['metadataMethodIndex'])+', RVA '+x['rva']+']' for x in rr[:8])
    if args.dump:
        assert args.dumpbin
        starts = sorted(byva)
        for mi in map(int, args.dump.split(',')):
            r = bymi[mi]
            va = int(r['va'], 16)
            assert va
            rva = va-base
            # Exception EndAddress may stop at a first IL2CPP funclet, not method end.
            end = next((a-base for a in starts if a>va), rva+256)
            assert 0 < end-rva <= 131072, (mi, rva, end)
            name = 'ui_native_'+str(mi)+'_'+re.sub(r'[^\w.-]', '_', r['declaringType'].split('.')[-1])+'_'+re.sub(r'[^\w.-]', '_', r['name'])+'_'+args.suffix+'.txt'
            p = args.out/name
            if p.exists():
                raise FileExistsError(p)
            proc = subprocess.run([str(args.dumpbin), '/NOLOGO', '/DISASM', '/RANGE:'+hex(va)+','+hex(base+end-1), str(dll)], capture_output=True)
            text = proc.stdout.decode('utf-8', 'replace')
            def annotate(m):
                l = label(int(m.group(2),16))
                return m.group(0)+(' ; '+l if l else '')
            text = re.sub(r'\b(call|jmp)\s+(?:0x)?([0-9A-Fa-f]{12,16})\b', annotate, text)
            prefix = '# '+r['declaringType']+'::'+r['name']+'\n# '+json.dumps(r, ensure_ascii=False)+'\n# Source DLL SHA256 '+hashlib.sha256(raw).hexdigest()+'\n# native range '+hex(rva)+'..'+hex(end)+'; dumpbin exit '+str(proc.returncode)+'\n'
            exclusive(p, prefix+text)
            print('DUMP', mi, hex(rva), 'size', end-rva, name, flush=True)
    if args.xref:
        targets = {}
        for mi in map(int, args.xref.split(',')):
            va = int(bymi[mi]['va'],16)
            targets.setdefault(va,[]).append(mi)
        refs = []
        for sec in pe.sections:
            if not sec.Characteristics & 0x20000000:
                continue
            data = sec.get_data()
            for i in range(len(data)-4):
                if data[i] not in (0xe8,0xe9):
                    continue
                at = base+sec.VirtualAddress+i
                dest = at+5+struct.unpack_from('<i',data,i+1)[0]
                if dest in targets:
                    start = owner(at)
                    refs.append({'instructionCandidateVA':hex(at),'instructionCandidateRVA':hex(at-base),'opcode':hex(data[i]),'targetMI':targets[dest],'target':label(dest),'ownerVA':hex(start) if start else None,'ownerRVA':hex(start-base) if start else None,'owner':label(start) if start else None,'ownerMethodIndices':[x['metadataMethodIndex'] for x in byva.get(start,[])]})
        exclusive(args.out/('ui_xrefs_'+args.suffix+'.json'), {'warning':'Raw E8/E9 candidates; verify with dumpbin before claiming an instruction xref. Inlined, indirect, generic and virtual calls are not covered.','refs':refs})
        print(json.dumps(refs,ensure_ascii=False,indent=2))
    if args.refs_from or args.vtables:
        meta_path = args.game/'Touhou Mystia Izakaya_Data/il2cpp_data/Metadata/global-metadata.dat'
        mb_ref = meta_path.read_bytes()
        hr = struct.unpack_from('<64I', mb_ref)
        tr = [struct.unpack_from('<16i8H2I', mb_ref, hr[40]+i*88) for i in range(hr[41]//88)]
        schemas = json.loads((args.out/'game_native_fields.json').read_text(encoding='utf-8'))
        types_byval = {x['byvalTypeIndex']:x for x in schemas}
        vt = struct.unpack_from('<'+str(hr[37]//4)+'I', mb_ref, hr[36])
        def decode_usage(v):
            kind = v >> 29
            ix = (v & 0x1fffffff) >> 1
            out = {'raw':hex(v),'kind':kind,'index':ix}
            if kind==3:
                out['method'] = bymi.get(ix)
            elif kind in (1,2):
                out['type'] = types_byval.get(ix)
                if out['type']:
                    out['type'] = {k:out['type'][k] for k in ('index','type','image','byvalTypeIndex')}
            elif kind==5:
                try:
                    n, at = struct.unpack_from('<2I',mb_ref,hr[2]+ix*8)
                    out['string'] = mb_ref[hr[4]+at:hr[4]+at+n].decode('utf-8')
                except (UnicodeDecodeError,struct.error):
                    out['string'] = '<decode failed>'
            return out
        results_ref = []
        for name in args.refs_from.split(',') if args.refs_from else []:
            text = (args.out/name).read_text(encoding='utf-8')
            refs_for_file = []
            for match in re.finditer(r'\[(?:0x)?([0-9A-Fa-f]{12,16})h?\]', text):
                address = int(match.group(1),16)
                try:
                    v = struct.unpack_from('<Q',raw,off(address))[0]
                    if v<=0xffffffff and v&1 and v>>29 in (1,2,3,5,6):
                        refs_for_file.append({'address':hex(address),'rva':hex(address-base),**decode_usage(v)})
                except (ValueError,struct.error,pefile.PEFormatError):
                    pass
            results_ref.append({'file':name,'references':list({x['address']:x for x in refs_for_file}.values())})
        vtables = []
        for ti in map(int,args.vtables.split(',')) if args.vtables else []:
            t = tr[ti]
            vtables.append({'typeIndex':ti,'type':next((x['type'] for x in schemas if x['index']==ti),None),'start':t[14],'count':t[21],'slots':[{'slot':slot,'il2cppClassOffsetHex':hex(0x138+slot*16),**decode_usage(vt[t[14]+slot])} for slot in range(t[21])]})
        exclusive(args.out/('ui_usage_refs_'+args.suffix+'.json'),{'files':results_ref,'vtables':vtables})
        print(json.dumps({'files':results_ref,'vtables':vtables},ensure_ascii=False,indent=2))
    if args.fields:
        meta = args.game/'Touhou Mystia Izakaya_Data/il2cpp_data/Metadata/global-metadata.dat'
        mb = meta.read_bytes()
        h = struct.unpack_from('<64I',mb)
        count = h[41]//88
        types = [struct.unpack_from('<16i8H2I',mb,h[40]+i*88) for i in range(count)]
        st = mb[h[6]:h[6]+h[7]]
        def s(i): return st[i:st.index(b'\0',i)].decode() if i>=0 else ''
        fs = [struct.unpack_from('<3i',mb,h[24]+i*12) for i in range(h[25]//12)]
        needle = struct.pack('<Q',count)
        registrations = []
        pos = raw.find(needle)
        while pos>=0:
            try:
                if struct.unpack_from('<Q',raw,pos+16)[0]==count:
                    fields_ptr = struct.unpack_from('<Q',raw,pos+8)[0]
                    sizes_ptr = struct.unpack_from('<Q',raw,pos+24)[0]
                    field_table = struct.unpack_from('<'+str(count)+'Q',raw,off(fields_ptr))
                    sample = field_table[3279]
                    offsets = struct.unpack_from('<4i',raw,off(sample))
                    if offsets[1]>=0 and offsets[1]<2048:
                        registrations.append({'fieldCountPos':hex(pe.get_rva_from_offset(pos)),'registrationRVA':hex(pe.get_rva_from_offset(pos)-80),'fieldOffsetsVA':hex(fields_ptr),'typeSizesVA':hex(sizes_ptr),'satoriOffsets':offsets})
            except (ValueError,struct.error,pefile.PEFormatError,IndexError):
                pass
            pos = raw.find(needle,pos+1)
        assert len(registrations)==1, registrations
        reg = registrations[0]
        table = struct.unpack_from('<'+str(count)+'Q',raw,off(int(reg['fieldOffsetsVA'],16)))
        results = []
        for ti in map(int,args.fields.split(',')):
            t = types[ti]
            n = t[18]
            ptr = table[ti]
            offsets = struct.unpack_from('<'+str(n)+'i',raw,off(ptr)) if ptr and n else []
            results.append({'typeIndex':ti,'type':(s(t[1])+'.' if s(t[1]) else '')+s(t[0]),'byvalTypeIndex':t[2],'parentTypeIndex':t[4],'offsetArrayVA':hex(ptr),'fields':[{'fieldIndex':j,'name':s(fs[j][0]),'typeIndex':fs[j][1],'offset':o,'offsetHex':hex(o) if o>=0 else str(o)} for j,o in zip(range(t[8],t[8]+n),offsets)]})
        exclusive(args.out/('ui_field_offsets_'+args.suffix+'.json'),{'metadataSHA256':hashlib.sha256(mb).hexdigest(),'assemblySHA256':hashlib.sha256(raw).hexdigest(),'registration':reg,'types':results})
        print(json.dumps(results,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
