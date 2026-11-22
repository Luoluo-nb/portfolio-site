// Rain/snow text and images come from 张致远作品集.pptx, slides 2–9.
// Card implementation text is checked against the existing PortfolioPTCGStage
// material shaders. Production notes and capture history stay out of page copy.
const figure = (name, width, height, caption, type = 'image') => ({
  src: `./media/breakdowns/${name}.webp`, width, height, caption, type,
});

export const projectDetails = {
  'td-particle-gesture': {
    title: '从 CT 网格到手势交互',
    introduction: '这套原型把解剖结构画成粒子。空间位置决定模型的形状，着色器决定它看起来像什么，摄像头捕捉的手势则用来切换效果和操控虚拟刀具。',
    chapters: [
      {
        id: 'medical-mesh', title: '从体数据提取表面',
        description: '建模流程参考马南的 Bioxel Nodes 案例。在 Blender 中把 CT 切片重建为三维网格，为后续粒子提供可采样的表面。',
        steps: [
          '读入 NIfTI（.nii）体数据，保留体素在三维空间中的位置与密度。',
          '按密度生成遮罩，把目标结构与周围组织分开。',
          '从遮罩提取表面，整理网格后送入 TouchDesigner。',
        ],
      },
      {
        id: 'medical-instances', title: '让粒子拼出骨架',
        description: '在 TouchDesigner 中，位置纹理为每个实例提供坐标，颜色纹理提供逐粒子颜色。粒子共享基础几何体，组合起来仍能读出肋骨、脊柱和骨盆的形状。',
        steps: [
          'GLSL 按实例读取属性，让同一批粒子的颜色和大小可以分别控制。',
          '图中的金色骨架用垂直位置驱动缩放。观察腰椎与骨盆，可以看到点的大小如何改变表面的疏密感。',
        ],
        figures: [figure('medical-particle-scale', 1386, 1110, '按高度缩放的骨骼粒子（研究文档图 39）')],
      },
      {
        id: 'medical-shading', title: '把连续光照整理成色阶',
        description: '材质研究比较了 PBR 的连续明暗与 NPR 的分段着色。骨面需要保留体积感，细小结构又容易淹没在反光里，因此将明暗、高光与轮廓分开调节。',
        steps: [
          '用表面法线与光照方向计算 Half-Lambert 明暗值，再采样 Ramp 色带，控制暗部和亮部的颜色。',
          '用半程向量控制高光阈值，用视线与法线的夹角提取轮廓光。演示中的浅色边缘让骨骼从深色背景中显出来。',
        ],
      },
      {
        id: 'medical-gestures', title: '用手势切换与操控',
        description: '普通摄像头把手部画面送入 TouchDesigner 的 MediaPipe 插件。演示左下角叠加了手部关键点和识别状态，操作者可以直接看出手有没有被识别。',
        steps: [
          '拇指向上触发效果切换，便于在同一视角比较不同显示方式。',
          '握拳进入虚拟刀具控制，画面同步反馈当前手势。',
        ],
      },
    ],
  },
  'unreal-multilegged-robot': {
    title: '多足机器人制作流程',
    introduction: '在 Blender 完成多足机器人的建模与骨骼绑定，接入 Unreal Engine 后用程序化骨骼动画驱动行走。',
    chapters: [
      {
        id: 'robot-modeling', title: 'Blender 建模',
        description: '在 Blender 中完成多足机器人的模型制作。',
      },
      {
        id: 'robot-rigging', title: '骨骼绑定',
        description: '为机器人模型完成骨骼绑定，让模型能够随骨骼姿态变化。',
      },
      {
        id: 'robot-unreal-import', title: '接入 Unreal Engine',
        description: '将完成绑定的机器人模型接入 Unreal Engine，用于后续的程序化动画。',
      },
      {
        id: 'robot-procedural-walk', title: '程序化骨骼动画与行走',
        description: '在 Unreal Engine 中以程序化方式驱动骨骼，形成这台多足机器人的行走动作。',
      },
    ],
  },
  'td-unreal-brush': {
    title: '手势画笔与墨迹流程',
    introduction: 'TouchDesigner 采集手部坐标并判断捏合，将滤波后的手势通过共享内存传给 Unreal Engine，在纸面绘制墨迹并表现随时间变干的效果。',
    chapters: [
      {
        id: 'brush-hand-position', title: 'MediaPipe 手部位置采集',
        description: 'TouchDesigner 通过 MediaPipe 获取手部和手指的 Position，作为画笔交互的输入。',
      },
      {
        id: 'brush-pinch-filter', title: '捏合判断、映射与滤波',
        description: '将手指位置转换为位置数据与捏合状态两类交互信号。',
        steps: [
          '用指尖之间的距离判断捏合状态。',
          '对位置进行映射与滤波，减少坐标噪声传到后续绘制环节。',
        ],
      },
      {
        id: 'brush-shared-memory', title: '共享内存传入 UE',
        description: '将处理后的手部位置与捏合状态通过共享内存传给 Unreal Engine。',
        steps: [
          '位置用于驱动画笔移动，捏合状态用于控制落笔与抬笔。',
        ],
      },
      {
        id: 'brush-rt-drying', title: 'RT 绘制与墨迹变干',
        description: '在 Unreal Engine 中将交互笔迹写入 Render Target，并用 Decal 把墨迹颜色映射到纸面。',
        steps: [
          '第一个 Render Target 保留已绘制的笔迹，让轨迹持续留在纸面。',
          'RT2 随时间更新墨迹的干燥表现，与保留笔迹的 RT 分开处理。',
        ],
      },
    ],
  },
  "unreal-car": {
  "title": "车辆材质实现方案",
  "introduction": "围绕车辆展示搭建车漆、水面与地面材质，结合按键变色、平面反射和接触涟漪，呈现材质与环境的交互。",
  "sourcePages": [
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    17,
    18
  ],
  "chapters": [
    {
      "id": "vehicle-paint-layers",
      "sourceSlide": 2,
      "title": "车漆分层与环境光照",
      "description": "将底色、金属片和清漆分层处理，通过不同法线与环境光照表现车漆的层次。",
      "steps": [
        "用法线混合金属片层，并通过 TBN 矩阵将切线空间法线转换到世界空间。",
        "分别计算底色与金属片层的光照，再混合清漆层的光照结果。",
        "底色与清漆层均使用粗糙度 0，共享环境光采样，减少一次采样。底色参数由蓝图传入。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-paint-front.webp",
          "width": 865,
          "height": 527,
          "caption": "车漆正面效果",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-paint-rear.webp",
          "width": 1100,
          "height": 546,
          "caption": "车漆后侧效果",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-paint-side.webp",
          "width": 1523,
          "height": 587,
          "caption": "车身侧面与反射",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-flake-normal.webp",
          "width": 1635,
          "height": 908,
          "caption": "金属片法线与空间转换",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-paint-lighting.webp",
          "width": 1742,
          "height": 992,
          "caption": "底色与环境光照混合",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-paint-output.webp",
          "width": 462,
          "height": 948,
          "caption": "车漆材质输出",
          "type": "diagram",
          "wide": false
        }
      ]
    },
    {
      "id": "vehicle-triplanar-uv",
      "sourceSlide": 4,
      "title": "三平面纹理映射",
      "description": "拼接三个投影平面的纹理坐标，用于曲面车身上的噪声纹理采样。",
      "steps": [
        "组合三平面 UV；针对曲面车身，省去切线、副切线与法线重合的判断。",
        "噪声纹理不依赖方向，移除正反面方向处理中使用的 sign 和负号乘法。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-triplanar.webp",
          "width": 2014,
          "height": 1125,
          "caption": "三平面坐标与法线方向处理",
          "type": "diagram",
          "wide": false
        }
      ]
    },
    {
      "id": "vehicle-paint-interaction",
      "sourceSlide": 7,
      "title": "按键变色与参数插值",
      "description": "通过材质参数集合统一控制车漆底色，按键切换时以插值过渡颜色。",
      "steps": [
        "在材质参数集合（MPC）中创建四维颜色参数，并在车漆材质中读取。",
        "蓝图保存三维颜色值，按键输入根据条件设置目标颜色。",
        "通过插值更新颜色，再将结果写入 MPC，使车漆平滑过渡。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-color-mpc.webp",
          "width": 1515,
          "height": 546,
          "caption": "颜色参数集合设置",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-color-material.webp",
          "width": 1074,
          "height": 374,
          "caption": "材质读取颜色参数",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-color-blueprint.webp",
          "width": 2559,
          "height": 1422,
          "caption": "按键切色与插值蓝图",
          "type": "diagram",
          "wide": false
        }
      ]
    },
    {
      "id": "vehicle-water-waves",
      "sourceSlide": 9,
      "title": "水面波浪与折射",
      "description": "以两层 Gerstner 波驱动水面起伏，叠加流动法线与接触涟漪，并混合反射和折射。",
      "steps": [
        "两层 Gerstner 波同时输出顶点位移与法线，驱动水面几何和光照变化。",
        "将波浪法线与一层流动法线贴图、涟漪法线叠加；以法线 XY 分量直接相加简化混合。",
        "只扭曲水下像素，保留水面前方物体的像素，再混合反射与折射。",
        "针对浅水平面，省去视觉影响较小的基础色、浅水色及屏幕边缘扭曲消除；静态接触区域使用一次捕获的纹理，替代最近表面距离查询。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-water-contact.webp",
          "width": 961,
          "height": 963,
          "caption": "水面与球体接触效果",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-water-car.webp",
          "width": 1244,
          "height": 1050,
          "caption": "车辆与水面整体效果",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-water-reflection.webp",
          "width": 1421,
          "height": 987,
          "caption": "低角度水面反射效果",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-water-waves.webp",
          "width": 1559,
          "height": 536,
          "caption": "波浪位移与法线组合",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-water-ripple.webp",
          "width": 1887,
          "height": 1131,
          "caption": "接触面水花遮罩动画",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-water-flow.webp",
          "width": 1194,
          "height": 616,
          "caption": "流动法线采样坐标",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-contact-uv.webp",
          "width": 1770,
          "height": 552,
          "caption": "世界坐标采样接触面纹理",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-reflection-uv.webp",
          "width": 1692,
          "height": 453,
          "caption": "屏幕坐标采样反射纹理",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-water-refraction.webp",
          "width": 1552,
          "height": 482,
          "caption": "折射遮罩与屏幕采样",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-water-edge.webp",
          "width": 1666,
          "height": 448,
          "caption": "浅水颜色与屏幕边缘处理",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-water-output.webp",
          "width": 642,
          "height": 500,
          "caption": "反射折射与波浪输出",
          "type": "diagram",
          "wide": false
        }
      ]
    },
    {
      "id": "vehicle-planar-reflection",
      "sourceSlide": 12,
      "title": "平面反射相机",
      "description": "将反射相机封装为独立 Actor，输出纹理供水面材质采样。",
      "steps": [
        "通过蓝图组织平面反射相机，使用场景捕获组件输出低动态范围图像。",
        "反射渲染纹理使用 RGBA8 格式；水面采样时翻转 X 轴，与反射画面对齐。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-reflection-format.webp",
          "width": 483,
          "height": 288,
          "caption": "反射纹理分辨率与格式",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-reflection-blueprint.webp",
          "width": 2250,
          "height": 1278,
          "caption": "平面反射相机蓝图",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-reflection-capture.webp",
          "width": 1007,
          "height": 345,
          "caption": "反射相机捕获设置",
          "type": "diagram",
          "wide": true
        }
      ]
    },
    {
      "id": "vehicle-contact-ripples",
      "sourceSlide": 13,
      "title": "接触区域深度与涟漪",
      "description": "用正交相机捕获接触区域深度，再将深度加工为遮罩、涟漪法线和径向信息。",
      "steps": [
        "设置正交相机的变换与宽度，仅捕获网格；静态场景在初始化时处理一次渲染纹理。",
        "以 R16F 保存原始深度，将纹理与 UV 对齐，筛出接触面高度附近的像素，生成 R16F 接触遮罩。",
        "将遮罩柔化为 R16F 中间结果，再从高度生成法线；将法线与径向颜色合并到 RGBA16F 纹理。",
        "水面通过世界坐标映射 UV 采样接触纹理，用于水花遮罩动画和涟漪法线。",
        "若正交捕获无法得到目标网格深度，可在骨骼位置放置仅场景捕获可见的圆柱体，作为辅助深度形状。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-depth-blueprint.webp",
          "width": 2559,
          "height": 1101,
          "caption": "接触面深度处理蓝图",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-depth-camera.webp",
          "width": 1125,
          "height": 542,
          "caption": "正交深度相机设置",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-contact-mask.webp",
          "width": 113,
          "height": 154,
          "caption": "接触面高度遮罩",
          "type": "preview",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-contact-blur.webp",
          "width": 146,
          "height": 212,
          "caption": "接触面柔化结果",
          "type": "preview",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-contact-normal.webp",
          "width": 127,
          "height": 197,
          "caption": "接触面法线结果",
          "type": "preview",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-contact-mask-nodes.webp",
          "width": 1542,
          "height": 246,
          "caption": "深度转换与接触面筛选",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-contact-blur-nodes.webp",
          "width": 858,
          "height": 585,
          "caption": "接触面模糊处理",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-contact-normal-nodes.webp",
          "width": 1635,
          "height": 645,
          "caption": "高度生成法线与通道合成",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-depth-proxy.webp",
          "width": 796,
          "height": 882,
          "caption": "深度采样辅助几何体",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-depth-proxy-car.webp",
          "width": 1359,
          "height": 490,
          "caption": "车轮位置的辅助采样体",
          "type": "image",
          "wide": false
        }
      ]
    },
    {
      "id": "vehicle-ground-tiling",
      "sourceSlide": 16,
      "title": "随机平铺与地面置换",
      "description": "用随机纹理变换减弱重复平铺，并结合高度纹理与 Nanite 置换表现地面细节。",
      "steps": [
        "一次计算三组 UV 哈希，分别用随机分量控制偏移、旋转和缩放，后续纹理采样复用这三组变换后的 UV。",
        "以梯度控制多级纹理采样，插值混合采样结果，减弱平铺接缝。",
        "使用相同映射采样高度、法线和 ORM 纹理，解包法线、环境遮蔽与粗糙度，并结合 Nanite 置换。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-ground-displacement.webp",
          "width": 1542,
          "height": 891,
          "caption": "地表位移近景",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-ground-medium.webp",
          "width": 1671,
          "height": 1077,
          "caption": "地表中距离效果",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-ground-distance.webp",
          "width": 1526,
          "height": 1041,
          "caption": "地表远距离平铺",
          "type": "image",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-stochastic-overview.webp",
          "width": 2100,
          "height": 573,
          "caption": "随机平铺采样组合",
          "type": "diagram",
          "wide": true
        },
        {
          "src": "./media/breakdowns/vehicle-stochastic-transform.webp",
          "width": 2021,
          "height": 903,
          "caption": "随机坐标变换与梯度",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-ground-output.webp",
          "width": 983,
          "height": 777,
          "caption": "地表材质通道输出",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-stochastic-sample.webp",
          "width": 1280,
          "height": 987,
          "caption": "多组纹理采样混合",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-nanite-displacement.webp",
          "width": 603,
          "height": 210,
          "caption": "Nanite 置换设置",
          "type": "diagram",
          "wide": true
        }
      ]
    },
    {
      "id": "vehicle-material-cost",
      "sourceSlide": 3,
      "title": "材质指令开销",
      "description": "车漆、水面与地面材质在对应配置下的编译指令数。",
      "steps": [
        "车漆：无光照、不透明材质，像素着色器（PS）200，顶点着色器（VS）148。",
        "水面：无光照、半透明材质，关闭默认功能后，PS 197，VS 191。",
        "地面：无光照、不透明并启用细分，Nanite 置换使用默认值，PS 197，VS 153，计算着色器（CS）858。"
      ],
      "figures": [
        {
          "src": "./media/breakdowns/vehicle-paint-cost.webp",
          "width": 1968,
          "height": 1283,
          "caption": "车漆材质节点与指令统计",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-water-cost.webp",
          "width": 1517,
          "height": 1325,
          "caption": "水面材质节点与指令统计",
          "type": "diagram",
          "wide": false
        },
        {
          "src": "./media/breakdowns/vehicle-ground-cost.webp",
          "width": 2070,
          "height": 1311,
          "caption": "地表材质节点与指令统计",
          "type": "diagram",
          "wide": false
        }
      ]
    }
  ]
},
  'ptcg-card': {
    title: '卡面材质实现方案',
    introduction: '将印刷图像与光学涂层分层处理，组合颗粒闪烁、分区反射和视差。',
    chapters: [
      {
        id: 'card-matte', title: '磨砂与亮片',
        description: '在固定 UV 中生成不规则微粒，通过随机倾角和多尺度叠加形成细颗粒亮片。',
        steps: [
          '以视线与光线的半程向量驱动亮片反射，用粗糙度展宽高光，保留磨砂膜下的闪烁。',
          '用面部保护遮罩降低亮片强度，保持人物细节清晰。',
        ],
        figures: [],
      },
      {
        id: 'card-lines', title: '细线高光与双层视差',
        description: '用分区遮罩控制卡面不同区域的细线高光，将外层与内层反射分开计算。',
        steps: [
          '依据切线空间视线偏移内层采样位置，形成双层视差。',
          '用各向异性高光与不同粗糙度塑造细线方向感，再叠加两层反射。',
        ],
        figures: [],
      },
      {
        id: 'card-volume', title: 'Texture3D 角度采样',
        description: '将涂层的角度外观存入 512×728×48 的 Texture3D，以卡面 UV 和角度索引共同采样。',
        steps: [
          '由视线与光照方向计算角度索引，在相邻切片间插值，使反射连续变化。',
          '通过区域遮罩组合涂层、原画与局部高光，保留图像的主体层次。',
        ],
        figures: [],
      },
    ],
  },
  'rain-vat': {
    title: '雨水效果制作拆解',
    introduction: '通过材质叠加、涟漪法线与水花序列帧，组合车身雨滴、地面积水和降雨粒子。',
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
