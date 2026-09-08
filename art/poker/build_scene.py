"""Author the original poker lounge and seated player assets with Blender 4.5.

Run in Blender's Python environment, with __file__ pointing to this script.
Coordinates throughout the modeling code follow the game's x/y-up/z-forward
interface. Blender receives (-x, -z, y); its Y-up glTF export becomes (-x, y, z).
Babylon's default left-handed glTF root flips X back to the game's coordinates.
Only scenes tagged by this script are replaced when the script is run again.
"""

from collections import defaultdict
import json
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public" / "models"
AUTHORING = ROOT / "artifacts" / "blender"
OWNER = "cleaver-poker-original-art"
TAU = math.tau


def point(value):
    x, y, z = value
    return Vector((-x, -z, y))


def material(name, color, roughness=.65, metallic=0, emission=0):
    name = "Poker / " + name
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels]
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*linear, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*linear, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        shader.inputs["Emission Color"].default_value = (*linear, 1)
        shader.inputs["Emission Strength"].default_value = emission
    return result


def surface(obj, paint, smooth=True):
    obj.data.materials.append(paint)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def mesh(name, vertices, faces, paint, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata([point(v) for v in vertices], [], faces)
    data.update()
    editable = bmesh.new()
    editable.from_mesh(data)
    bmesh.ops.recalc_face_normals(editable, faces=list(editable.faces))
    editable.to_mesh(data)
    editable.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return surface(obj, paint, smooth)


def box(name, at, size, paint, bevel=.012, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=point(at))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    surface(obj, paint)
    if bevel:
        modifier = obj.modifiers.new("Soft manufactured edges", 'BEVEL')
        modifier.width = min(bevel, min(size) * .4)
        modifier.segments = segments
        normals = obj.modifiers.new("Weighted face normals", 'WEIGHTED_NORMAL')
        normals.keep_sharp = True
    return obj


def oval(name, at, size, paint, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=point(at))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] / 2, size[2] / 2, size[1] / 2)
    return surface(obj, paint)


def lathe(name, profile, paint, segments=64, at=(0, 0, 0), closed=False):
    vertices = [(at[0] + radius * math.sin(TAU * i / segments), at[1] + height,
                 at[2] + radius * math.cos(TAU * i / segments))
                for radius, height in profile for i in range(segments)]
    faces = []
    for row in range(len(profile) if closed else len(profile) - 1):
        following = (row + 1) % len(profile)
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((row * segments + i, row * segments + j,
                          following * segments + j, following * segments + i))
    if not closed:
        faces.extend([tuple(reversed(range(segments))),
                      tuple((len(profile) - 1) * segments + i for i in range(segments))])
    return mesh(name, vertices, faces, paint)


def ring(name, radius, height, width, paint, segments=96, vertical=None):
    profile = [(radius + width * math.cos(TAU * j / 8), height + (vertical or width) * math.sin(TAU * j / 8))
               for j in range(8)]
    return lathe(name, profile, paint, segments, closed=True)


def profile_body(name, rows, paint, segments=32):
    """Rows sculpt height, half-width, half-depth and the front/back center."""
    vertices = [(width * math.sin(TAU * i / segments), height, center + depth * math.cos(TAU * i / segments))
                for height, width, depth, center in rows for i in range(segments)]
    faces = [(row * segments + i, row * segments + (i + 1) % segments,
              (row + 1) * segments + (i + 1) % segments, (row + 1) * segments + i)
             for row in range(len(rows) - 1) for i in range(segments)]
    faces.extend([tuple(reversed(range(segments))), tuple((len(rows) - 1) * segments + i for i in range(segments))])
    return mesh(name, vertices, faces, paint)


def bezier(controls, count=16):
    a, b, c, d = [Vector(v) for v in controls]
    return [a * (1 - t) ** 3 + b * 3 * t * (1 - t) ** 2 + c * 3 * t * t * (1 - t) + d * t ** 3
            for t in (i / (count - 1) for i in range(count))]


def tube(name, path, radii, paint, sides=10, flatten=1):
    """A tapered swept mesh, used for limbs, individual fingers and hair locks."""
    path = [Vector(p) for p in path]
    if isinstance(radii, (float, int)):
        radii = [radii] * len(path)
    vertices = []
    for i, center in enumerate(path):
        tangent = (path[min(i + 1, len(path) - 1)] - path[max(0, i - 1)]).normalized()
        reference = Vector((0, 0, 1)) if abs(tangent.z) < .92 else Vector((1, 0, 0))
        u = tangent.cross(reference).normalized()
        v = tangent.cross(u).normalized()
        vertices.extend(center + radii[i] * (u * math.cos(TAU * j / sides) + v * math.sin(TAU * j / sides) * flatten)
                        for j in range(sides))
    faces = [(i * sides + j, i * sides + (j + 1) % sides,
              (i + 1) * sides + (j + 1) % sides, (i + 1) * sides + j)
             for i in range(len(path) - 1) for j in range(sides)]
    faces.extend([tuple(reversed(range(sides))), tuple((len(path) - 1) * sides + j for j in range(sides))])
    return mesh(name, vertices, faces, paint)


def patch(name, outline, thickness, paint):
    count = len(outline)
    vertices = list(outline) + [(x, y, z - thickness) for x, y, z in outline]
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    faces.extend((i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count))
    return mesh(name, vertices, faces, paint, smooth=False)


def isolated_scene(name):
    previous = bpy.data.scenes.get(name)
    if previous:
        if previous.get("author") != OWNER:
            raise RuntimeError(f"Refusing to replace an unrelated Blender scene: {name}")
        for obj in list(previous.objects):
            if len(obj.users_scene) == 1:
                bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(previous)
    scene = bpy.data.scenes.new(name)
    scene["author"] = OWNER
    bpy.context.window.scene = scene
    scene.unit_settings.system = 'METRIC'
    scene.view_settings.view_transform = 'AgX'
    return scene


def build_lounge():
    scene = isolated_scene("Poker Lounge — Original Art")
    teal = material("Midnight teal walls", "#183a39", .83)
    inset = material("Recessed petrol panels", "#204a44", .78)
    walnut = material("Oiled walnut", "#674733", .42)
    dark_wood = material("Walnut end grain", "#352d26", .5)
    brass = material("Brushed old brass", "#b59a62", .35, .55)
    leather = material("Dark olive rail leather", "#283c30", .55)
    felt = material("Tournament green baize", "#33765c", .94)
    carpet = material("Deep teal wool carpet", "#203d37", .98)
    stitch = material("Warm woven piping", "#978b5d", .8)
    ivory = material("Linen and amber glass", "#edce94", .7, emission=.45)
    art_green = material("Art enamel sage", "#6b8570", .6)
    floor_colors = [material(f"Walnut floor tone {i + 1}", color, .65)
                    for i, color in enumerate(["#453b30", "#4b3c30", "#514133"])]

    for row in range(22):
        for column in range(5):
            box("Individual walnut floorboard", (-5.775 + row * .55, -.055, -4.8 + column * 2.4),
                (.546, .1, 2.394), floor_colors[(row + column * 2) % 3], .003, 1)
    lathe("Round woven carpet", [(4.33, .002), (4.34, .012), (4.33, .023)], carpet, 96)
    for radius in (3.95, 4.06, 4.25):
        ring("Carpet woven border", radius, .025, .008, stitch, vertical=.0015)
    for i in range(32):
        angle = i * TAU / 32
        tube("Carpet radial stitch", [(math.sin(angle) * r, .026, math.cos(angle) * r) for r in (4.1, 4.19)], .0025, stitch, 6)

    lathe("Sculpted walnut table pedestal", [(.68, .035), (.73, .07), (.71, .14), (.58, .2),
          (.47, .3), (.37, .46), (.34, .72), (.4, .89), (.73, 1.035), (.94, 1.08)], walnut)
    for radius, height in ((.70, .15), (.35, .73), (.83, 1.04)):
        ring("Pedestal brass collar", radius, height, .013, brass, 64)
    lathe("Layered walnut tabletop", [(2.31, 1.095), (2.40, 1.12), (2.475, 1.17),
          (2.475, 1.235), (2.455, 1.28), (2.39, 1.295)], walnut, 96)
    ring("Outer brass inlay", 2.474, 1.21, .007, brass)
    lathe("Padded leather table rail", [(2.213, 1.318), (2.24, 1.353), (2.29, 1.375),
          (2.35, 1.379), (2.413, 1.359), (2.446, 1.324), (2.43, 1.287), (2.23, 1.286)], leather, 96, closed=True)
    lathe("Level green playing surface", [(2.215, 1.32), (2.215, 1.335)], felt, 96)
    ring("Inner leather seam", 2.28, 1.374, .0035, stitch)
    ring("Fine felt betting line", 1.54, 1.337, .005, stitch, vertical=.001)

    for wall in range(4):
        before = set(scene.objects)
        box("Plaster wall", (0, 2.5, 6), (12.1, 5.2, .18), teal)
        box("Walnut wainscot", (0, .67, 5.86), (12, 1.32, .16), dark_wood)
        for height in (.14, 1.30, 1.39):
            box("Horizontal wall molding", (0, height, 5.735), (12, .035, .08), brass, .005)
        for x in (-4, 0, 4):
            box("Recessed wall panel", (x, 2.88, 5.88), (3.55, 2.65, .12), inset)
            for side in (-1, 1):
                box("Panel stile", (x + side * 1.79, 2.87, 5.775), (.038, 2.79, .035), brass, .004)
            for height in (1.475, 4.265):
                box("Panel cross molding", (x, height, 5.775), (3.62, .038, .035), brass, .004)
        for x in (-2, 2):
            box("Sconce brass backplate", (x, 2.68, 5.67), (.34, .96, .10), brass, .04)
            for rib in range(5):
                oval("Fluted amber sconce glass", (x + (rib - 2) * .053, 2.70, 5.575),
                     (.06, .62, .11), ivory, 12, 8)
            for height in (2.365, 3.035):
                box("Sconce end cap", (x, height, 5.568), (.34, .055, .15), brass)
        transform = Matrix.Rotation(wall * math.pi / 2, 4, 'Z')
        for obj in set(scene.objects) - before:
            obj.matrix_world = transform @ obj.matrix_world

    box("Original deco artwork frame", (0, 2.72, 5.69), (2.55, 1.65, .13), walnut, .035)
    box("Artwork brass reveal", (0, 2.72, 5.61), (2.42, 1.52, .024), brass, .009)
    box("Artwork enamel field", (0, 2.72, 5.589), (2.36, 1.46, .026), teal, .006)
    for index in range(4):
        radius = .30 + index * .17
        arc = [(-.22 + math.sin(t) * radius, 2.52 + math.cos(t) * radius, 5.56)
               for t in (i * math.pi / 32 - math.pi / 2 for i in range(33))]
        tube("Inlaid rising-sun arch", arc, .011, brass, 6)
    patch("Sage landscape inlay", [(-1.14, 2.08, 5.554), (-1.14, 2.54, 5.554), (-.63, 2.31, 5.554),
          (-.14, 2.61, 5.554), (.52, 2.23, 5.554), (1.14, 2.43, 5.554), (1.14, 2.08, 5.554)], .006, art_green)
    return scene


def build_person():
    scene = isolated_scene("Poker Player — Original Art")
    skin = material("Warm skin", "#c48f71", .65)
    skin_shadow = material("Warm lip and ear detail", "#956451", .72)
    hair = material("Espresso swept hair", "#302720", .62)
    hair_light = material("Chestnut hair planes", "#49362a", .58)
    coat = material("Tailored slate jacket", "#58716e", .78)
    coat_dark = material("Lapel and seam cloth", "#3b5551", .74)
    shirt = material("Unbleached shirt cotton", "#eee0c5", .87)
    dark = material("Pupil and lash detail", "#211d1b", .55)
    iris = material("Hazel iris", "#6d5842", .45)
    eye_white = material("Warm eye white", "#f1e9d8", .35)
    pants = material("Charcoal wool trousers", "#353f3d", .92)
    shoe = material("Polished oxblood shoe", "#3d2d2a", .32)
    wood = material("Oiled walnut", "#674733", .42)
    brass = material("Brushed old brass", "#b59a62", .35, .55)
    upholstery = material("Chair olive upholstery", "#344b40", .8)

    box("Upholstered chair seat", (0, .73, -.03), (.76, .13, .70), upholstery, .055)
    box("Walnut chair back", (0, 1.03, -.325), (.78, .95, .13), wood, .055)
    box("Tufted back cushion", (0, 1.05, -.235), (.69, .80, .105), upholstery, .047)
    for x in (-.225, -.075, .075, .225):
        tube("Chair channel seam", [(x, .70, -.177), (x, 1.40, -.177)], .003, coat_dark, 6)
    for x in (-.28, .28):
        for z in (-.27, .24):
            tube("Splayed walnut chair leg", [(x * 1.2, .06, z * 1.18), (x, .69, z)], [.024, .035], wood, 10)

    oval("Seated trouser hips", (0, .88, .02), (.61, .27, .44), pants)
    for side in (-1, 1):
        tube("Tailored bent trouser leg", [(side * .18, .88, .09), (side * .205, .82, .31),
             (side * .215, .68, .46), (side * .21, .37, .47), (side * .21, .12, .47)],
             [.13, .135, .112, .085, .076], pants, 14)
        oval("Leather dress shoe", (side * .21, .09, .56), (.19, .135, .38), shoe)
        box("Shoe sole", (side * .21, .045, .56), (.19, .033, .36), dark, .016)

    profile_body("Shaped jacket torso", [(1.005, .26, .15, 0), (1.10, .295, .16, 0),
                 (1.28, .292, .175, -.004), (1.47, .335, .185, -.012),
                 (1.59, .369, .173, -.018), (1.665, .302, .151, -.014),
                 (1.713, .118, .105, .004)], coat)
    patch("Shirt chest", [(-.098, 1.695, .13), (.098, 1.695, .13), (.105, 1.47, .174),
          (0, 1.325, .178), (-.10, 1.47, .174)], .018, shirt)
    for side in (-1, 1):
        patch("Notched jacket lapel", [(side * .105, 1.697, .151), (side * .23, 1.598, .172),
              (side * .178, 1.545, .184), (side * .211, 1.50, .186),
              (side * .038, 1.318, .189), (side * .096, 1.533, .19)], .015, coat_dark)
        patch("Open shirt collar", [(side * .014, 1.725, .11), (side * .095, 1.70, .148),
              (side * .103, 1.595, .183), (side * .032, 1.631, .188)], .012, shirt)
    for height in (1.20, 1.325, 1.445):
        oval("Horn jacket button", (.018, height, .183), (.021, .021, .012), dark, 12, 8)
    box("Welt chest pocket", (-.215, 1.487, .164), (.10, .013, .018), coat_dark, .003)
    patch("Folded linen pocket square", [(-.257, 1.492, .166), (-.253, 1.533, .168),
          (-.225, 1.516, .169), (-.197, 1.529, .165), (-.192, 1.493, .171)], .008, shirt)

    tube("Raised left jacket sleeve", [(-.325, 1.597, -.013), (-.452, 1.649, .02),
         (-.519, 1.784, .074), (-.467, 1.932, .146), (-.403, 2.048, .204)],
         [.116, .115, .106, .09, .068], coat, 14)
    tube("Visible left shirt cuff", [(-.407, 2.038, .20), (-.384, 2.082, .221)], [.071, .066], shirt, 14)
    tube("Raised left wrist", [(-.387, 2.071, .217), (-.345, 2.153, .266),
         (-.305, 2.254, .307), (-.285, 2.308, .327)], [.056, .055, .042, .038], skin, 14)
    oval("Card-holding palm", (-.282, 2.327, .323), (.072, .10, .055), skin, 16, 10)
    for finger in range(4):
        height = 2.287 + finger * .026
        path = bezier([(-.298, height, .33), (-.277, height + .025, .364),
                       (-.244, height + .016, .371), (-.225, height + .003, .345)], 8)
        tube(f"Separate holding finger {finger + 1}", path, [.0115] * 6 + [.010, .007], skin, 8)
        oval("Subtle fingernail", (-.239, height + .01, .364), (.018, .012, .004), shirt, 10, 6)
    tube("Thumb behind the card edge", bezier([(-.31, 2.307, .305), (-.3, 2.271, .285),
         (-.27, 2.26, .267), (-.242, 2.291, .278)], 10), [.015] * 8 + [.012, .008], skin, 9)
    tube("Right jacket upper arm only", [(.329, 1.593, -.016), (.394, 1.546, .05),
         (.432, 1.46, .19), (.403, 1.389, .30)], [.116, .11, .096, .086], coat, 14)

    lathe("Natural neck", [(.084, 1.688), (.088, 1.77), (.087, 1.843)], skin, 24, at=(0, 0, .007))
    profile_body("Sculpted jaw cheeks and skull", [(1.814, .079, .091, .039), (1.838, .114, .132, .027),
                 (1.88, .171, .167, .017), (1.969, .218, .187, .008),
                 (2.058, .232, .188, .004), (2.143, .226, .183, -.005),
                 (2.23, .207, .172, -.019), (2.301, .153, .128, -.032),
                 (2.334, .058, .065, -.029)], skin, 40)
    for side in (-1, 1):
        oval("Soft cheek plane", (side * .119, 1.98, .166), (.17, .105, .075), skin)
        oval("Ear outer helix", (side * .235, 2.027, .004), (.075, .142, .077), skin, 16, 10)
        oval("Ear inner fold", (side * .248, 2.033, .043), (.035, .082, .017), skin_shadow, 12, 8)
        oval("Almond eye", (side * .108, 2.078, .191), (.121, .077, .085), eye_white)
        oval("Hazel iris disc", (side * .106, 2.079, .232), (.047, .051, .009), iris, 16, 10)
        oval("Dark pupil", (side * .106, 2.079, .238), (.024, .032, .006), dark, 12, 8)
        oval("Eye catchlight", (side * .106 - .009, 2.092, .242), (.009, .011, .003), eye_white, 8, 6)
        for upper in (True, False):
            points = [(side * .108 + .063 * math.cos(t), 2.077 + (.038 if upper else .032) * math.sin(t),
                       .221 + .004 * math.sin(t)) for t in
                      ((i / 14 * math.pi) + (0 if upper else math.pi) for i in range(15))]
            tube("Sculpted eyelid", points, .007 if upper else .005, skin, 8)
        brow = bezier([(side * .045, 2.127, .204), (side * .077, 2.15, .212),
                       (side * .138, 2.143, .209), (side * .171, 2.126, .19)], 12)
        tube("Expressive tapered eyebrow", brow, [.005, .009, .012, .013, .013, .012, .011, .009, .008, .006, .004, .002], hair, 8)
    profile_body("Shaped nose bridge and tip", [(1.963, .033, .023, .243), (1.977, .043, .036, .259),
                 (1.998, .039, .04, .264), (2.032, .026, .034, .239),
                 (2.089, .022, .024, .213), (2.116, .012, .01, .205)], skin, 20)
    for side in (-1, 1):
        oval("Nostril recess", (side * .029, 1.97, .276), (.018, .01, .014), skin_shadow, 10, 6)
    oval("Shaped lower lip", (0, 1.893, .199), (.135, .032, .033), skin_shadow, 20, 8)
    tube("Quiet smile line", bezier([(-.071, 1.909, .202), (-.035, 1.895, .223),
         (.038, 1.895, .223), (.071, 1.913, .2)], 18), .0035, dark, 7)

    profile_body("Swept hairstyle base", [(2.172, .22, .163, -.027), (2.232, .229, .181, -.029),
                 (2.302, .193, .159, -.037), (2.349, .126, .108, -.04), (2.361, .025, .028, -.038)], hair, 36)
    for lock in range(10):
        offset = (lock - 4.5) * .044
        path = bezier([(offset, 2.211 + .018 * math.cos(lock), .128),
                       (offset - .075, 2.372, .118), (offset - .035, 2.418, -.055),
                       (offset + .046, 2.276, -.18)], 14)
        radii = [.009 + .021 * math.sin(math.pi * i / 13) for i in range(14)]
        tube("Sculpted swept hair lock", path, radii, hair_light if lock % 3 == 0 else hair, 9, flatten=.65)
    for side in (-1, 1):
        tube("Tapered sideburn", [(side * .218, 2.207, -.015), (side * .23, 2.124, .023),
             (side * .222, 2.065, .028)], [.027, .023, .006], hair, 9, flatten=.65)

    for name, location in (("betting_arm_socket", (.4, 1.38, .3)), ("forehead_card_socket", (0, 2.45, .3))):
        socket = bpy.data.objects.new(name, None)
        scene.collection.objects.link(socket)
        socket.location = point(location)
        socket.empty_display_size = .055
        socket["game_coordinates"] = list(location)
    return scene


def join_by_material(scene):
    bpy.context.window.scene = scene
    bpy.ops.object.select_all(action='DESELECT')
    objects = [obj for obj in scene.objects if obj.type == 'MESH']
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target='MESH')
    groups = defaultdict(list)
    for obj in scene.objects:
        if obj.type == 'MESH':
            groups[obj.data.materials[0].name].append(obj)
    for paint, members in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in members:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        if len(members) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = paint.replace("Poker / ", "")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')


def export(scene, filename):
    join_by_material(scene)
    triangles = 0
    for obj in scene.objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    destination = MODELS / filename
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', use_active_scene=True,
                             export_yup=True, export_apply=True, export_animations=False,
                             export_cameras=False, export_lights=False, export_extras=True,
                             export_materials='EXPORT', export_texcoords=False)
    size = destination.stat().st_size
    assert size < 3 * 1024 * 1024, f"Asset exceeds the 3 MB limit: {filename} ({size} bytes)"
    return {"file": str(destination), "triangles": triangles, "bytes": size,
            "mesh_count": sum(obj.type == 'MESH' for obj in scene.objects)}


def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    AUTHORING.mkdir(parents=True, exist_ok=True)
    lounge = build_lounge()
    person = build_person()
    report = [export(lounge, "poker-lounge.glb"), export(person, "poker-person.glb")]
    total = sum(asset["triangles"] for asset in report)
    assert total <= 60000, f"Triangle budget exceeded: {total} > 60000"
    bpy.context.window.scene = lounge
    bpy.ops.wm.save_as_mainfile(filepath=str(AUTHORING / "poker-original-assets.blend"))
    print("POKER_ASSET_REPORT " + json.dumps({"assets": report, "total_triangles": total}))


if __name__ == "__main__":
    main()
