"""Crop the original Summoner's Rift OBJ to its Baron pit in Blender.

Source: https://p3dm.ru/files/others/others/15244-summonersrift-map.html
Extract the original OBJ, MTL and DDS textures under artifacts/blender/rift.
Riot Games owns the map. JDarkGFX published this rip for personal use.
"""
from pathlib import Path
import re
import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'artifacts/blender/rift/SummonersRift'
OUTPUT = ROOT / 'public/models/baron-pit.glb'
material_text = (SOURCE / 'SummonersRift.mtl').read_text(errors='replace')
material_text = re.sub(r'^map_Kd .*[/\\]([^/\\\n]+)$', r'map_Kd Textures/\1', material_text, flags=re.M)
(SOURCE / 'base.mtl').write_text(material_text.replace('Kd 0 0 0', 'Kd 1 1 1'))
scene = bpy.data.scenes.new('Cleaver Baron pit')
bpy.context.window.scene = scene
bpy.ops.wm.obj_import(filepath=str(SOURCE / 'SummonersRift.obj'), forward_axis='NEGATIVE_Z', up_axis='Y')
ground = next(obj for obj in scene.objects if obj.type == 'MESH')
ground.scale *= .01
bpy.context.view_layer.update()
center = Vector((-50, -106, 0))
hit, point, *_ = scene.ray_cast(bpy.context.evaluated_depsgraph_get(), Vector((-50,-106,50)), Vector((0,0,-1)))
if not hit:
    raise RuntimeError('The Baron pit floor was not found in the source map.')
center.z = point.z
mesh = bmesh.new()
mesh.from_mesh(ground.data)
for vertex in mesh.verts:
    vertex.co = ground.matrix_world @ vertex.co
bmesh.ops.delete(mesh, geom=[face for face in mesh.faces if (face.calc_center_median().xy - center.xy).length > 26], context='FACES')
for vertex in mesh.verts:
    vertex.co = (vertex.co - center) * 1.9
    # The server's circular court is flat. Preserve the original texture coordinates.
    if vertex.co.xy.length < 10.6 and abs(vertex.co.z) < 1.5:
        vertex.co.z = -.025
mesh.to_mesh(ground.data)
mesh.free()
ground.matrix_world.identity()
ground.name = 'Original Baron pit'
used = {face.material_index for face in ground.data.polygons}
for index in reversed(range(len(ground.material_slots))):
    if index not in used:
        ground.data.materials.pop(index=index)
images = {}
for material in ground.data.materials:
    nodes = material.node_tree.nodes
    texture = next((node for node in nodes if node.type == 'TEX_IMAGE'), None)
    if texture and texture.image and texture.image.name not in images:
        texture.image.reload()
    if not texture or not texture.image or texture.image.size[0] == 0:
        raise RuntimeError(f'Missing map texture: {material.name}')
    image = texture.image
    if image.name not in images:
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        images[image.name] = bool(np.min(pixels[3::4]) < .99)
    nodes.clear()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    output = nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(texture.outputs['Color'], output.inputs['Surface'])
    if images[image.name]:
        image.alpha_mode = 'STRAIGHT'
        transparent = nodes.new('ShaderNodeBsdfTransparent')
        mix = nodes.new('ShaderNodeMixShader')
        cutoff = nodes.new('ShaderNodeMath')
        cutoff.operation = 'GREATER_THAN'
        cutoff.inputs[1].default_value = .5
        material.node_tree.links.new(texture.outputs['Alpha'], cutoff.inputs[0])
        material.node_tree.links.new(cutoff.outputs[0], mix.inputs[0])
        material.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
        material.node_tree.links.new(texture.outputs['Color'], mix.inputs[2])
        material.node_tree.links.new(mix.outputs[0], output.inputs['Surface'])
    material.use_backface_culling = False
texture_dir = ROOT / 'artifacts/blender/baron-textures'
texture_dir.mkdir(parents=True, exist_ok=True)
for name, has_alpha in images.items():
    image = bpy.data.images[name]
    if max(image.size) > 1024:
        ratio = 1024 / max(image.size)
        image.scale(round(image.size[0] * ratio), round(image.size[1] * ratio))
    image.file_format = 'PNG' if has_alpha else 'JPEG'
    image.filepath_raw = str(texture_dir / (name + ('.png' if has_alpha else '.jpg')))
    image.save()
ground.select_set(True)
bpy.context.view_layer.objects.active = ground
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True, use_active_scene=True, export_animations=False, export_image_format='AUTO', export_jpeg_quality=90)
bpy.data.libraries.write(str(ROOT / 'artifacts/blender/baron-prepared.blend'), {scene})
print('BARON_READY', len(ground.data.polygons), 'triangles', len(ground.data.materials), 'materials', OUTPUT.stat().st_size, 'bytes')
