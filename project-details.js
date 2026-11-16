// Text and images are adapted only from 张致远作品集.pptx, slides 2–9.
// Original text, image dimensions and source relationships are recorded in
// .sites-runtime/pptx-source/manifest.json. No performance claims are inferred.
const figure = (name, width, height, caption, type = 'image') => ({
  src: `./media/breakdowns/${name}.webp`, width, height, caption, type,
});

export const projectDetails = {
  'rain-vat': {
    title: '雨水效果制作拆解',
    introduction: '从车身雨滴、地面积水到雨水粒子，记录材质叠加、涟漪贴图与水花序列帧的制作过程。',
    sourcePages: [2, 3, 4, 5, 6],
    chapters: [
      {
        id: 'rain-body', sourceSlide: 2, title: '车身雨水',
        description: '使用世界法线划分车身表面，让雨水沿不同朝向的表面流动。',
        steps: [
          '按世界法线区分 6 个区域，在 XZ、XY、YZ 平面使用世界坐标采样 Flow Map。',
          '用世界法线的 Z 分量控制流动范围，再混合雨水法线。',
        ],
        figures: [
          figure('rain-body-close', 1338, 968, '车身与玻璃上的雨水细节'),
          figure('rain-body-overview', 1224, 825, '车辆整体雨水效果'),
        ],
      },
      {
        id: 'wet-ground', sourceSlide: 3, title: '地面积水与涟漪',
        description: '通过积水遮罩、粗糙度与流动法线，组合地面的潮湿区域和涟漪。',
        steps: [
          '用 Displacement 贴图与常量生成积水 Mask，通过 Lerp 得到低粗糙度区域。',
          '叠加流动的 Normal Map，混合烘焙涟漪贴图中的法线。',
        ],
        figures: [
          figure('wet-ground-ripples', 1647, 770, '积水表面的涟漪与反射'),
          figure('wet-ground-reflection', 1298, 717, '地面潮湿区域与粗糙度变化'),
          figure('ripple-normal-preview', 647, 471, '涟漪法线贴图预览'),
        ],
      },
      {
        id: 'ripple-textures', sourceSlide: 4, title: '涟漪贴图制作',
        description: '在 TouchDesigner 中烘焙涟漪贴图，并用 GLSL 编写法线。',
        steps: [
          '通过节点流程生成涟漪贴图。',
          '使用 GLSL 计算法线，检查各通道与合成结果。',
        ],
        figures: [
          figure('ripple-texture-channels', 1647, 1089, '涟漪贴图与法线结果', 'diagram'),
          figure('ripple-normal-glsl', 1851, 1209, 'GLSL 法线与通道预览', 'diagram'),
          figure('ripple-node-graph', 2247, 1107, 'TouchDesigner 涟漪节点流程', 'diagram'),
        ],
      },
      {
        id: 'niagara-rain', sourceSlide: 5, title: 'Niagara 雨水粒子',
        description: '用两个 GPU 发射器分别表现落地水花与空中的雨滴。',
        steps: [
          'GPU Emitter 1 在地面生成 Sprite，使用 SubUV 播放水花序列帧，并用动态参数控制溶解。',
          'GPU Emitter 2 在空中生成下落的 Sprite，模拟雨滴。',
        ],
        figures: [
          figure('rain-splashes', 867, 447, '地面水花粒子'),
          figure('rain-ground-overview', 1047, 654, '降雨与地面水花的组合效果'),
          figure('rain-splash-close', 360, 251, '单个水花细节'),
        ],
      },
      {
        id: 'houdini-flip', sourceSlide: 6, title: 'Houdini 水花序列帧',
        description: '从 FLIP 模拟生成水花，缓存点和网格后渲染序列帧，保留法线 RG 与反射通道。',
        steps: [
          '对球体进行 FLIP from Object 模拟，以法线乘噪声生成 Velocity。',
          '缓存 Point 与 Mesh，渲染水花序列帧。',
          '输出法线 RG 和反射通道，供雨水粒子材质使用。',
        ],
        figures: [
          figure('flip-sequence-preview', 1086, 996, '水花序列帧材质预览'),
          figure('flip-simulation', 1212, 824, 'Houdini FLIP 水花模拟'),
          figure('flip-normal-sequence', 1290, 1371, '法线 RG 序列帧'),
          figure('flip-reflection-sequence', 1278, 1353, '反射通道序列帧'),
          figure('flip-source-nodes', 713, 363, 'FLIP 模拟节点', 'diagram'),
          figure('flip-cache-nodes', 582, 933, '缓存与网格处理节点', 'diagram'),
        ],
      },
    ],
  },
  'unreal-snow': {
    title: '雪地与车轮交互拆解',
    introduction: '通过 Render Target 记录雪地交互与车轮沾雪，结合世界坐标、轮心局部坐标和蓝图参数完成材质映射。',
    sourcePages: [7, 8, 9],
    chapters: [
      {
        id: 'snow-rt', sourceSlide: 7, title: '雪地 RT 交互与自阴影',
        description: '将 Actor 深度写入 Render Target，逐帧保留雪地交互痕迹，再由材质读取。',
        steps: [
          'Scene Capture 读取 Actor 深度，将 Actor 世界坐标映射到 UV，绘制至单通道 RT1。',
          '将 RT1 保存到 RT2，材质使用世界坐标读取 RT2。',
          '下一帧将 max（深度，RT2）写入 RT1，再保存至 RT2。',
        ],
        figures: [
          figure('snow-tracks-overview', 1467, 896, '车辆转向后的雪地痕迹'),
          figure('snow-tracks-rear', 947, 693, '轮胎压痕与雪地阴影'),
          figure('snow-self-shadow', 618, 636, '雪地自阴影代码', 'diagram'),
        ],
      },
      {
        id: 'wheel-snow', sourceSlide: 8, title: '车轮沾雪',
        description: '车轮沾雪 RT 的效果展示，包含车辆前方、侧方、后方与俯视视角。',
        figures: [
          figure('wheel-snow-front', 1422, 918, '前方视角：轮胎与地面积雪'),
          figure('wheel-snow-side', 1173, 615, '侧方视角：车轮沾雪'),
          figure('wheel-snow-rear', 1191, 702, '后方视角：轮胎与雪地交互'),
          figure('wheel-tracks-overview', 1500, 960, '俯视视角：车轮路径与痕迹'),
        ],
      },
      {
        id: 'wheel-rt-mapping', sourceSlide: 9, title: '四轮 RT 映射与蓝图参数',
        description: '分别处理轮胎缝隙与表面的 RT，通过车辆局部坐标区分四个轮子，并控制边缘过渡。',
        steps: [
          '轮胎缝隙使用单通道 RT，以 1/8 + n/4 区分四个轮子的区域。',
          '蓝图传入 Bone2 的方向与位置，计算相对轮心的局部坐标，再转换为本地 XZ 平面的极坐标。',
          '蓝图传入碰撞结果，以 Array Index 区分四轮对应的 RT V，骨骼旋转映射到 RT U。',
        ],
        figures: [
          figure('wheel-gap-rt', 1101, 204, '轮胎缝隙 RT：四轮区域', 'diagram'),
          figure('wheel-surface-rt', 1086, 186, '轮胎表面 RT', 'diagram'),
          figure('wheel-edge-blend', 1080, 327, '边缘过渡代码', 'diagram'),
          figure('wheel-local-coordinates', 1143, 968, '轮心局部坐标与极坐标转换', 'diagram'),
          figure('wheel-index-selection', 1389, 444, '车辆局部坐标区分四轮', 'diagram'),
          figure('wheel-rt-blueprint', 2043, 852, '碰撞结果、骨骼与 RT 参数蓝图', 'diagram'),
        ],
      },
    ],
  },
};
