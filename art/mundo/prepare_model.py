"""Prepare the downloaded Dr. Mundo model in Blender for the private fan game.

Source: https://modelviewer.lol/model-viewer?id=36000
Download model.glb to artifacts/blender/drmundo-original.glb before running.
The mesh, textures and animations belong to Riot Games.
"""
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/models'
OUTPUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Cleaver Mundo prepared')
bpy.context.window.scene = scene
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'artifacts/blender/drmundo-original.glb'))
body = next(obj for obj in scene.objects if obj.type == 'MESH' and obj.name.startswith('Meshes'))
rig = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
for obj in list(scene.objects):
    if obj not in (body, rig):
        bpy.data.objects.remove(obj, do_unlink=True)

# The source contains both normal and ultimate bodies and hidden emote props.
# Keep its default visible submeshes, so overlapping bodies never reach the game.
mesh = bmesh.new()
mesh.from_mesh(body.data)
bmesh.ops.delete(mesh, geom=[face for face in mesh.faces if not body.material_slots[face.material_index].material.get('visible', False)], context='FACES')
mesh.to_mesh(body.data)
mesh.free()
used = {face.material_index for face in body.data.polygons}
for index in reversed(range(len(body.material_slots))):
    if index not in used:
        body.data.materials.pop(index=index)

clips = {'DrMundo_Idle01.anm': 'idle', 'DrMundo_Run.anm': 'run', 'Spell1': 'throw', 'Death': 'death'}
for track in list(rig.animation_data.nla_tracks):
    original = track.name
    if original not in clips:
        rig.animation_data.nla_tracks.remove(track)
    else:
        track.name = clips[original]
        for strip in track.strips:
            strip.action.name = clips[original]
            strip.name = clips[original]
rig.animation_data.action = None
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
height = max(point.z for point in points) - min(point.z for point in points)
rig.scale *= 2.2 / height
bpy.context.view_layer.update()

# Export a separate textured cleaver for the thrown projectile and first-person hand.
weapon = body.copy()
weapon.data = body.data.copy()
scene.collection.objects.link(weapon)
weapon.name = 'Mundo cleaver'
weapon.matrix_world = body.matrix_world.copy()
weapon.parent = None
weapon.modifiers.clear()
mesh = bmesh.new()
mesh.from_mesh(weapon.data)
bmesh.ops.delete(mesh, geom=[face for face in mesh.faces if weapon.material_slots[face.material_index].name.split('.')[0] != 'Weapon'], context='FACES')
mesh.to_mesh(weapon.data)
mesh.free()
used = {face.material_index for face in weapon.data.polygons}
for index in reversed(range(len(weapon.material_slots))):
    if index not in used:
        weapon.data.materials.pop(index=index)
points = [weapon.matrix_world @ vertex.co for vertex in weapon.data.vertices]
low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
center = (low + high) * .5
scale = .9 / max(high - low)
for vertex in weapon.data.vertices:
    vertex.co = (weapon.matrix_world @ vertex.co - center) * scale
weapon.matrix_world.identity()
for obj in scene.objects:
    obj.select_set(False)
weapon.select_set(True)
bpy.context.view_layer.objects.active = weapon
bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'mundo-cleaver.glb'), export_format='GLB', use_selection=True, use_active_scene=True, export_animations=False)
bpy.data.objects.remove(weapon, do_unlink=True)

rig.data.pose_position = 'POSE'
for track in rig.animation_data.nla_tracks:
    track.mute = False
rig.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'artifacts/blender/mundo-prepared.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'mundo.glb'), export_format='GLB', use_selection=True, use_active_scene=True,
    export_animation_mode='ACTIONS', export_nla_strips=True, export_force_sampling=False, export_anim_single_armature=False,
    export_frame_range=False, export_optimize_animation_size=True)
print('MUNDO_READY', len(body.data.polygons), 'triangles', [track.name for track in rig.animation_data.nla_tracks],
      {name: (OUTPUT / name).stat().st_size for name in ('mundo.glb', 'mundo-cleaver.glb')})
