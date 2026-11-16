// 在这里填充个人介绍和作品。分类使用 unity 或 unreal；未确定引擎可留空。
export const profile = {
  name: '张致远',
  about: '我是一名技术美术，专注于 Unity 与 Unreal Engine 的 Shader、实时特效和工具开发。工作覆盖汽车材质与交互展示、游戏材质优化、程序化资产及实时互动项目，连接视觉表现与技术实现。',
  bilibili: 'https://space.bilibili.com/31364151',
  experience: [
    {period:'2026.04 — 至今', company:'赛力斯集团股份有限公司', role:'技术美术', summary:'汽车 Substrate 内外饰材质与交互效果；UE C++ 插件、编辑器工具及 Compute Shader 工具；PCG 资产与 Houdini VAT 资产、HMI 多屏展示与 OpenXR 调试。'},
    {period:'2025.10 — 2025.11', company:'成都烽炊网络游戏有限责任公司', role:'技术美术', summary:'Unity 地形融合、雨滴与水面、Shell 毛绒及 SSS 材质开发与优化；顶点色笔刷工具和 VFX Graph 特效。'},
    {period:'2024.06 — 2025.08', company:'UAL 武汉招生办公室', role:'游戏特效 · 教学指导', summary:'Unity、Blender 与交互项目教学指导，协助学生完成项目制作。'},
    {period:'2023.07 — 2023.10', company:'深圳奥雅设计股份有限公司', role:'产品设计助理', summary:'Rhino 建模、D5 渲染与游乐场方案设计；概念排版、汇报视频及 AI 辅助设计。'},
  ],
  education: [
    {period:'2023 — 2026', school:'罗马大学', degree:'硕士 · 产品与服务设计'},
    {period:'2019 — 2023', school:'武汉理工大学', degree:'本科 · 产品设计'},
  ],
  skills: [
    {title:'着色器与渲染', text:'HLSL · GLSL · PBR · BRDF · SSS · Raymarching · 风格化渲染'},
    {title:'特效与动画', text:'VFX Graph · Niagara · Particle System · Timeline · Sequencer'},
    {title:'工具与流程', text:'C++ · C# · Python · Compute Shader · PCG · Houdini VAT'},
    {title:'建模与交互', text:'Blender · Rhino · 3ds Max · Grasshopper · OpenCV · MediaPipe'},
  ],
};

// Bilibili 作品用 bvid / cid；本地视频用 videoSrc；references 提供参考与素材说明。
// 播放器在点击播放按钮后加载。仅选择或悬停作品不会自动播放。
export const projects = [
  {id:'showreel-2026', title:'26届ta作品集', category:'', description:'2026 · 技术美术作品集', bvid:'BV19hP9zvEh7', cid:36579050716, duration:208, cover:'./media/BV19hP9zvEh7.jpg'},
  {id:'ptcg-card', title:'卡面光学材质研究', category:'unity', description:'Unity 2022.3 / URP 14 · 同一张卡依次展示磨砂亮片、分区细线高光与双层视差、48 层 Texture3D 涂层，通过卡片与灯光运动呈现不同工艺的角度响应。\n29 秒递进展示：0–3 秒磨砂，3–5 秒渐变；5–15 秒细线，15–17 秒渐变；17–29 秒 Texture3D。非无缝循环。Texture3D 为 512×728×48 的外观采样，不代表实测 BRDF。\n测试插画由用户提供，原画 WLOP；开源代码参考 Daniel Ilett 与 Pokébox。视频为离线逐帧录制，30 fps 不代表实时性能。', bvid:'BV1kZsP6jEaa', startTime:1.7, duration:29, loop:false, videoChapters:[{label:'磨砂',time:0},{label:'细线',time:5},{label:'Texture3D',time:17}], cover:'./media/ptcg-card.jpg', references:[{label:'Daniel Ilett',url:'https://github.com/daniel-ilett/shaders-holo-card'},{label:'Pokébox',url:'https://github.com/selop/pokebox'},{label:'素材与制作说明',url:'./media/ptcg-credits.txt'}]},
  {id:'studies-2025', title:'2025 作品与练习', category:'', description:'2025 · 作品与练习记录', bvid:'BV1Ja3tzsEXd', cid:30811095855, duration:516, cover:'./media/BV1Ja3tzsEXd.jpg'},
  {id:'unreal-car', title:'ue车车作品集更新~~', category:'unreal', subcategory:'vehicle', description:'Unreal Engine · 车辆视觉展示', bvid:'BV1oxd1BtEGy', cid:37683202347, duration:69, cover:'./media/BV1oxd1BtEGy.jpg'},
  {id:'rain-vat', title:'雨水材质与流体效果', category:'unreal', subcategory:'vehicle', description:'Unreal Engine · 车辆雨水、地面积水与降雨粒子。\n从世界法线分区、Flow Map 和涟漪法线，到 Niagara 粒子与 Houdini FLIP 序列帧的制作过程。', bvid:'BV1TCQEBtEJA', cid:37526242180, duration:20, cover:'./media/BV1TCQEBtEJA.jpg'},
  {id:'unreal-snow', title:'雪地交互与车轮沾雪', category:'unreal', subcategory:'vehicle', description:'Unreal Engine · 使用 Render Target 记录雪地交互，并将四个车轮的接触信息映射到轮胎材质。\n详情包含雪地自阴影、轮胎沾雪及蓝图参数的实现过程。', bvid:'BV1CZDzBCEyj', cid:37323869335, duration:40, cover:'./media/BV1CZDzBCEyj.jpg'},
];
