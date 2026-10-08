# Diff physics-relevant tagged properties between two builds' decrypted packages.
#   constants_diff.py OLD_DIR NEW_DIR OUT_PREFIX
# OLD_DIR/NEW_DIR contain TAGame.upk, GameInfo_Soccar_SF.upk, Startup.upk, Stadium_P.upk, ProjectX.upk and bodies/*.upk.
# Writes OUT_PREFIX.diff.txt (every changed / added / removed value) and OUT_PREFIX.bodies.tsv (per-body physics summary
# of NEW_DIR) and prints a summary.
import gc, os, re, resource, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'scripts'))
# A misparsed array count makes props.py read on past the object (its reader is bounded only by the package), which
# can eat all memory. Cap the address space and skip any object that raises MemoryError.
resource.setrlimit(resource.RLIMIT_AS, (8 * 1024 ** 3, 8 * 1024 ** 3))
SKIPPED = []
MAX_EXPORT = 4 * 1024 ** 2
from package import Package  # noqa: E402
from props import PropReader  # noqa: E402

old_dir, new_dir, out = sys.argv[1:4]

# Which objects to compare, per package: (path regex, class regex)
PHYS = (r'^(PhysicsConfig_TA|CarComponent_.*|VehicleSim_TA|Wheel_TA|Car_TA|Ball_.*TA|Vehicle_TA|RBActor_TA|'
        r'VehiclePickup.*|.*BoostPad.*|GameEvent_Soccar_TA|GameEvent_TA|RB_BodySetup|PhysicsAsset|.*Handling.*|'
        r'.*Mutator.*|CylinderComponent|GoalVolume_TA|Goal_TA)$')
NOT_PHYS = re.compile(r'(Mesh|Material|Texture|Particle|Sound|Ak|Anim|Font|Swf|GFx|Light|Decal|Distribution|Fog|'
                      r'PostProcess|Camera|Image|Movie|Shader|Skel|Interp|Seq|Emitter|Morph|Brush|Model|Lens)')
SELECT = {
    'TAGame.upk': [(r'^Default__', r''), (r'^Archetypes\.', r''), (r'', r'^(PhysicsConfig_TA|CarComponent_.*|'
                   r'VehicleSim_TA|Wheel_TA|Car_TA|Ball_TA.*|Vehicle_TA|RBActor_TA|VehiclePickup.*|BoostPickup.*|'
                   r'GameEvent_Soccar_TA|GameEvent_TA|.*Mutator.*|RB_BodySetup|PhysicsAsset|HandlingPreset.*)$')],
    'GameInfo_Soccar_SF.upk': [(r'^Archetypes\.', r''), (r'', PHYS)],
    'Startup.upk': [(r'^HandlingPresets\.', r''), (r'^Archetypes\.', r''), (r'', PHYS)],
    'Stadium_P.upk': [(r'', r'^(VehiclePickup.*|.*Boost.*|CylinderComponent|.*Pickup.*|GoalVolume.*|.*Goal.*)$')],
    'ProjectX.upk': [(r'^Default__', r'')],
}
SKIP_KEYS = re.compile(r'(^|/)(_net_index|_archetype|ObjectArchetype|TemplateOwnerClass|TemplateName)$')

def flatten(v, p, out):
    if isinstance(v, dict):
        for k, x in v.items():
            flatten(x, p + '/' + str(k), out)
    elif isinstance(v, list):
        for i, x in enumerate(v[:64]):
            flatten(x, p + '[%d]' % i, out)
        if len(v) > 64:
            out[p + '/<len>'] = len(v)
    else:
        if not SKIP_KEYS.search(p):
            if isinstance(v, (bytes, bytearray, str)) and len(v) > 256:   # big blobs: keep only size and hash
                import hashlib
                v = '<%d %s sha1 %s>' % (len(v), type(v).__name__,
                                         hashlib.sha1(v if isinstance(v, (bytes, bytearray)) else v.encode()).hexdigest()[:12])
            out[p] = v

def collect(d, name, rules):
    path = os.path.join(d, name)
    if not os.path.exists(path):
        return {}
    pkg = Package(path); pr = PropReader(pkg)
    vals = {}
    for e in pkg.exports:
        cn = pkg.class_name(e['index']); pth = pkg.path(e['index'])
        if cn in ('Class', 'Function', 'ScriptStruct', 'Enum', 'Const', 'State', 'Package') or cn.endswith('Property'):
            continue
        if not any(re.search(pr_, pth) and re.search(cr_, cn) for pr_, cr_ in rules):
            continue
        if NOT_PHYS.search(cn):
            continue
        if e['size'] > MAX_EXPORT:
            SKIPPED.append('%s:%s (size %d)' % (name, pth, e['size'])); continue
        try:
            o, _, _ = pr.read_object(e)
        except MemoryError:
            o = None; gc.collect(); SKIPPED.append('%s:%s (MemoryError)' % (name, pth)); continue
        except Exception as ex:  # unreadable object: record the failure so it shows up if it differs
            vals['%s:%s/<error>' % (name, pth)] = type(ex).__name__
            continue
        flatten(o, '%s:%s' % (name, pth), vals)
    return vals

def body_rows(d):
    rows = {}
    bdir = os.path.join(d, 'bodies')
    for f in sorted(os.listdir(bdir)) if os.path.isdir(bdir) else []:
        try:
            pkg = Package(os.path.join(bdir, f)); pr = PropReader(pkg)
        except Exception as ex:
            SKIPPED.append('%s (package unreadable: %s)' % (f, type(ex).__name__)); continue
        for e in pkg.exports:
            cn = pkg.class_name(e['index'])
            if cn in ('ProductAsset_Body_TA', 'RB_BodySetup', 'PhysicsAsset'):
                try:
                    o, _, _ = pr.read_object(e)
                except MemoryError:
                    gc.collect(); SKIPPED.append('%s:%s (MemoryError)' % (f, pkg.path(e['index']))); continue
                except Exception as ex:
                    rows['%s:%s/<error>' % (f.lower(), pkg.path(e['index']))] = type(ex).__name__
                    continue
                flatten(o, '%s:%s' % (f.lower(), pkg.path(e['index'])), rows)
    return rows

a, b = {}, {}
for name, rules in SELECT.items():
    a.update(collect(old_dir, name, rules)); b.update(collect(new_dir, name, rules))
ba, bb = body_rows(old_dir), body_rows(new_dir)
a.update(ba); b.update(bb)

def fmt(v):
    return repr(v)
changed = [(k, a[k], b[k]) for k in sorted(set(a) & set(b)) if a[k] != b[k]]
added = sorted(set(b) - set(a)); removed = sorted(set(a) - set(b))
with open(out + '.diff.txt', 'w') as f:
    f.write('# changed %d, added %d, removed %d (old %d values, new %d)\n' % (len(changed), len(added), len(removed),
                                                                          len(a), len(b)))
    f.write('## changed\n')
    for k, x, y in changed:
        f.write('%s\t%s\t->\t%s\n' % (k, fmt(x), fmt(y)))
    f.write('## added\n')
    for k in added:
        f.write('%s\t%s\n' % (k, fmt(b[k])))
    f.write('## removed\n')
    for k in removed:
        f.write('%s\t%s\n' % (k, fmt(a[k])))
print('values old %d new %d: changed %d, added %d, removed %d' % (len(a), len(b), len(changed), len(added),
                                                                   len(removed)))
print('skipped objects: %d' % len(SKIPPED))
for s_ in SKIPPED[:50]:
    print('  skipped', s_)
old_bodies = {k.split(':')[0] for k in ba}; new_bodies = {k.split(':')[0] for k in bb}
print('bodies old %d new %d, new bodies: %s' % (len(old_bodies), len(new_bodies),
                                                ', '.join(sorted(new_bodies - old_bodies))))
