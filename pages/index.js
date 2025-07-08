import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

function Home() {
  const [terraformToolEquipped, setTerraformToolEquipped] = useState(false)
  const [landLevelToolEquipped, setLandLevelToolEquipped] = useState(false)
  const [showHeightEditor, setShowHeightEditor] = useState(false)
  const [editingHeight, setEditingHeight] = useState(1.0)
  const [selectedBlock, setSelectedBlock] = useState(null)
  const [showAutoTerrainModal, setShowAutoTerrainModal] = useState(false)
  const [autoTerrainHilliness, setAutoTerrainHilliness] = useState(2.0)
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const keysRef = useRef({})
  const mouseRef = useRef({ isDown: false, lastX: 0, lastY: 0 })
  const fpsRef = useRef(null); // Ref for the FPS display element
  const cursorSphereRef = useRef(null); // Ref for the cursor sphere
  const platformRef = useRef(null); // Ref for the platform mesh
  const terrainMeshRef = useRef(null); // Ref for the generated terrain mesh
  const mousePositionRef = useRef({ x: 0, y: 0 }); // Mouse position in normalized coordinates
  const terraformingRef = useRef({ 
    isActive: false, 
    lastPosition: null, 
    instancedMesh: null,
    sphereCount: 0,
    maxSpheres: 999999, // Increased for more flexibility
    positions: [],
    matrix: new THREE.Matrix4()
  }); // Terraforming state
  const sunRef = useRef(null); // Sun reference
  const moonRef = useRef(null); // Moon reference
  const starsRef = useRef(null); // Stars reference
  const skyboxRef = useRef(null); // Skybox reference
  const dayNightRef = useRef({ time: 0 }); // Day/night cycle time
  const frameCountRef = useRef(0); // Frame counter for optimization
  const shadowUpdateRef = useRef(0); // Shadow update counter
  const performanceRef = useRef({ averageFPS: 60, fpsHistory: [] }); // Performance tracking
  const terraformToolRef = useRef({ equipped: false }); // Terraform tool state
  const landLevelToolRef = useRef({ 
    equipped: false,
    state: 'idle', // 'idle', 'first-corner', 'second-corner', 'height-adjust'
    startPoint: null,
    endPoint: null,
    currentHeight: 1,
    baseHeight: 0,
    heightAdjustStartY: 0,
    previewMesh: null,
    wireframeMesh: null,
    rectangles: [],
    selectedRectangle: null,
    hoveredRectangle: null
  }); // Land level tool state
  const autoTerrainRef = useRef({ generating: false }); // Auto terrain generation state

  useEffect(() => {
    if (!mountRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    
    // Add atmospheric fog
    scene.fog = new THREE.Fog(0x87CEEB, 50, 400)
    
    sceneRef.current = scene

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    camera.position.set(0, 5, 10)
    cameraRef.current = camera

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, // Re-enabled for quality
      powerPreference: 'high-performance',
      stencil: false, // Keep disabled for performance
      depth: true, // Keep depth buffer
      logarithmicDepthBuffer: false // Keep disabled for performance
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // Increased back to 2
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap // Better shadow quality
    renderer.shadowMap.autoUpdate = false // Keep manual shadow updates for performance
    renderer.info.autoReset = false // Keep disabled for debugging
    rendererRef.current = renderer
    mountRef.current.appendChild(renderer.domElement)

    // Create platform
    const platformGeometry = new THREE.BoxGeometry(20, 1, 20)
    const platformMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
    const platform = new THREE.Mesh(platformGeometry, platformMaterial)
    platform.position.y = -0.5
    platform.receiveShadow = true
    platformRef.current = platform // Store reference for raycasting
    scene.add(platform)

    // Create skybox with gradient shader
    const skyboxGeometry = new THREE.SphereGeometry(800, 32, 16)
    const skyboxMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        sunPosition: { value: new THREE.Vector3(50, 30, 0) },
        moonPosition: { value: new THREE.Vector3(-50, 30, 0) }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          vNormal = normalize(normalMatrix * normal);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 sunPosition;
        uniform vec3 moonPosition;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        
        // Simple noise function for clouds
        float noise(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }
        
        // Smooth noise function
        float smoothNoise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          
          float a = noise(i);
          float b = noise(i + vec2(1.0, 0.0));
          float c = noise(i + vec2(0.0, 1.0));
          float d = noise(i + vec2(1.0, 1.0));
          
          vec2 u = f * f * (3.0 - 2.0 * f);
          
          return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        
        // Fractal noise for more complex cloud patterns
        float fractalNoise(vec2 st) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          
          for (int i = 0; i < 4; i++) {
            value += amplitude * smoothNoise(st * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
          }
          return value;
        }
        
        void main() {
          vec3 viewDirection = normalize(vWorldPosition);
          float height = viewDirection.y;
          
          // Calculate sun and moon directions
          vec3 sunDir = normalize(sunPosition);
          vec3 moonDir = normalize(moonPosition);
          
          // Time-based cycle (0 = midnight, 0.5 = noon, 1 = midnight)
          float cycleProgress = (sin(time) + 1.0) / 2.0;
          
          // Sky colors for different times
          vec3 dayTopColor = vec3(0.5, 0.7, 1.0);      // Light blue
          vec3 dayBottomColor = vec3(0.8, 0.9, 1.0);   // Lighter blue
          vec3 nightTopColor = vec3(0.0, 0.0, 0.1);    // Dark blue
          vec3 nightBottomColor = vec3(0.1, 0.1, 0.2); // Slightly lighter dark blue
          
          // Sunset/Sunrise colors
          vec3 sunsetColor = vec3(1.0, 0.6, 0.3);      // Orange
          vec3 sunriseColor = vec3(1.0, 0.8, 0.6);     // Yellow-orange
          
          // Calculate base sky gradient
          float skyGradient = smoothstep(-0.1, 0.3, height);
          vec3 dayColor = mix(dayBottomColor, dayTopColor, skyGradient);
          vec3 nightColor = mix(nightBottomColor, nightTopColor, skyGradient);
          
          // Calculate sunset/sunrise effects
          float sunDot = dot(viewDirection, sunDir);
          float sunEffect = pow(max(0.0, sunDot), 8.0);
          
          // Calculate horizon glow
          float horizonGlow = 1.0 - abs(height);
          horizonGlow = pow(horizonGlow, 3.0);
          
          // Mix colors based on time of day
          vec3 skyColor = mix(nightColor, dayColor, cycleProgress);
          
          // Add sunset/sunrise effects when sun is near horizon
          if (sunPosition.y < 20.0 && sunPosition.y > -20.0) {
            float sunsetIntensity = (1.0 - abs(sunPosition.y) / 20.0) * horizonGlow;
            vec3 sunsetMix = mix(sunriseColor, sunsetColor, step(0.0, sin(time + 3.14159 / 2.0)));
            skyColor = mix(skyColor, sunsetMix, sunsetIntensity * 0.7);
          }
          
          // Add sun glow
          if (cycleProgress > 0.1) {
            skyColor = mix(skyColor, vec3(1.0, 1.0, 0.8), sunEffect * cycleProgress * 0.3);
          }
          
          // Generate distinct, realistic clouds
          if (height > 0.02) { // Even lower threshold for cloud generation
            // Create cloud coordinates using spherical mapping to avoid seams
            vec3 sphereCoord = normalize(viewDirection);
            vec2 cloudCoord = vec2(
              atan(sphereCoord.z, sphereCoord.x) / (2.0 * 3.14159) + 0.5, // Normalized longitude [0,1]
              acos(sphereCoord.y) / 3.14159 // Normalized latitude [0,1]
            );
            
            // Scale coordinates for cloud patterns
            cloudCoord *= vec2(8.0, 4.0); // Different scaling for longitude/latitude
            
            // Animate clouds by moving them slowly
            cloudCoord.x += time * 0.02; // Slower movement for bigger clouds
            
            // Generate distinct cloud clusters using multiple noise layers
            float cloudNoise1 = fractalNoise(cloudCoord * 0.3 + vec2(0.0, 0.0));
            float cloudNoise2 = fractalNoise(cloudCoord * 0.5 + vec2(100.0, 50.0));
            float cloudNoise3 = fractalNoise(cloudCoord * 0.7 + vec2(200.0, 100.0));
            
            // Combine noises to create distinct cloud formations
            float cloudNoise = cloudNoise1 * 0.6 + cloudNoise2 * 0.3 + cloudNoise3 * 0.1;
            
            // Add detail noise for cloud edges
            float detailNoise = fractalNoise(cloudCoord * 2.0) * 0.3;
            cloudNoise = mix(cloudNoise, cloudNoise + detailNoise, 0.5);
            
            // Create cloud mask for realistic distribution
            float cloudMask = smoothstep(0.02, 0.95, height) * smoothstep(1.0, 0.15, height);
            cloudNoise *= cloudMask;
            
            // Define cloud threshold for distinct clouds
            float cloudThreshold = 0.3; // Higher threshold for distinct clouds
            float cloudDensity = smoothstep(cloudThreshold, cloudThreshold + 0.4, cloudNoise);
            
            // Add variation to cloud density for more realistic appearance
            cloudDensity *= smoothstep(0.2, 0.8, cloudNoise);
            
            // Cloud colors based on time of day - much more contrasted
            vec3 dayCloudColor = vec3(1.0, 1.0, 1.0);        // Pure white clouds during day
            vec3 nightCloudColor = vec3(0.05, 0.05, 0.15);   // Very dark blue-gray at night
            vec3 sunsetCloudColor = vec3(1.0, 0.4, 0.1);     // Bright orange-red during sunset
            
            vec3 cloudColor = mix(nightCloudColor, dayCloudColor, cycleProgress);
            
            // Add sunset coloring to clouds when sun is low
            if (sunPosition.y < 30.0 && sunPosition.y > -10.0) {
              float sunsetCloudFactor = (1.0 - abs(sunPosition.y - 10.0) / 40.0);
              cloudColor = mix(cloudColor, sunsetCloudColor, sunsetCloudFactor * 0.7);
            }
            
            // Apply cloud lighting based on sun position - enhanced
            float cloudLighting = 1.0;
            if (cycleProgress > 0.1) {
              // Much brighter lighting calculation for day clouds
              cloudLighting = max(0.8, cycleProgress * 1.2) + 0.4;
            } else {
              cloudLighting = 0.6; // Brighter night lighting
            }
            
            cloudColor *= cloudLighting;
            
            // Blend clouds with sky - adjusted for distinct clouds
            skyColor = mix(skyColor, cloudColor, cloudDensity * 1.5);
          }
          
          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    })
    
    const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial)
    skybox.frustumCulled = false
    skyboxRef.current = skybox
    scene.add(skybox)

    // Create cursor sphere (green translucent) - optimized
    const cursorGeometry = new THREE.SphereGeometry(0.5, 8, 6) // Reduced from 16,16
    const cursorMaterial = new THREE.MeshBasicMaterial({ // Changed to MeshBasicMaterial for performance
      color: 0x00ff00, 
      transparent: true, 
      opacity: 0.6 
    })
    const cursorSphere = new THREE.Mesh(cursorGeometry, cursorMaterial)
    cursorSphere.position.y = 0 // Will be updated based on mouse position
    cursorSphere.visible = false // Initially hidden
    cursorSphere.frustumCulled = true // Enable frustum culling
    cursorSphereRef.current = cursorSphere
    scene.add(cursorSphere)

    // Random cubes removed for cleaner terrain

    // Create instanced mesh for terraform spheres (performance optimization)
    const terraformGeometry = new THREE.SphereGeometry(0.5, 12, 8) // Slightly higher quality than individual spheres
    const terraformMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x00aa00,
      transparent: false // Better performance without transparency
    })
    const terraformInstancedMesh = new THREE.InstancedMesh(
      terraformGeometry, 
      terraformMaterial, 
      terraformingRef.current.maxSpheres
    )
    terraformInstancedMesh.castShadow = true
    terraformInstancedMesh.receiveShadow = true
    terraformInstancedMesh.frustumCulled = false // Disable frustum culling to prevent disappearing
    terraformInstancedMesh.count = 0 // Start with no instances
    terraformingRef.current.instancedMesh = terraformInstancedMesh
    scene.add(terraformInstancedMesh)

    // Create sun with smooth gradient from core to edge
    const sunGeometry = new THREE.SphereGeometry(3, 16, 12)
    const sunMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec3 vPosition;
        
        void main() {
          float dist = length(vPosition) / 3.0; // Normalize by sphere radius
          float radialGradient = 1.0 - dist;
          float turbulence = 0.0;
          turbulence += sin(time * 1.5 + vPosition.x * 4.0) * 0.02;
          turbulence += sin(time * 2.0 + vPosition.y * 3.0) * 0.015;
          turbulence += sin(time * 1.2 + vPosition.z * 5.0) * 0.01;
          radialGradient += turbulence;
          radialGradient = clamp(radialGradient, 0.0, 1.0);
          vec3 coreColor = vec3(1.0, 1.0, 0.95);
          vec3 innerColor = vec3(1.0, 0.95, 0.8);
          vec3 middleColor = vec3(1.0, 0.85, 0.5);
          vec3 outerColor = vec3(1.0, 0.7, 0.3);
          vec3 edgeColor = vec3(1.0, 0.5, 0.2);
          vec3 sunColor = edgeColor;
          sunColor = mix(sunColor, outerColor, smoothstep(0.0, 0.3, radialGradient));
          sunColor = mix(sunColor, middleColor, smoothstep(0.2, 0.6, radialGradient));
          sunColor = mix(sunColor, innerColor, smoothstep(0.5, 0.8, radialGradient));
          sunColor = mix(sunColor, coreColor, smoothstep(0.7, 1.0, radialGradient));
          // SOLID ALPHA: fully opaque in the center, fade only at the edge
          float alpha = 1.0 - smoothstep(0.85, 1.0, dist); // Opaque until near the edge
          float glow = pow(1.0 - dist, 6.0) * 0.5;
          alpha = clamp(alpha + glow, 0.0, 1.0);
          float coreBrightness = smoothstep(0.6, 1.0, radialGradient);
          sunColor += coreBrightness * vec3(0.1, 0.05, 0.0);
          gl_FragColor = vec4(sunColor, alpha);
        }
      `,
      side: THREE.FrontSide,
      transparent: true,
    })
    const sun = new THREE.Mesh(sunGeometry, sunMaterial)
    sun.position.set(50, 30, 0)
    sunRef.current = sun
    scene.add(sun)

    // Create sun gas cloud corona - improved blending
    const coronaGeometry = new THREE.SphereGeometry(8, 32, 24) // Larger radius for gas cloud
    const coronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        
        // Noise function for gas clouds
        float noise(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }
        
        float smoothNoise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          
          float a = noise(i);
          float b = noise(i + vec2(1.0, 0.0));
          float c = noise(i + vec2(0.0, 1.0));
          float d = noise(i + vec2(1.0, 1.0));
          
          vec2 u = f * f * (3.0 - 2.0 * f);
          
          return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        
        float fractalNoise(vec2 st) {
          float value = 0
          float amplitude = 0.5
          float frequency = 1.0
          
          for (int i = 0; i < 3; i++) {
            value += amplitude * smoothNoise(st * frequency)
            amplitude *= 0.5
            frequency *= 2.0
          }
          return value
        }
        
        void main() {
          vec2 center = vUv - 0.5
          float dist = length(center)
          
          // Create animated gas cloud patterns
          vec2 gasCoord = vUv * 3.0 + time * 0.08
          float gasNoise = fractalNoise(gasCoord)
          gasNoise += fractalNoise(gasCoord * 2.0 + time * 0.12) * 0.5
          gasNoise += fractalNoise(gasCoord * 4.0 - time * 0.06) * 0.25
          
          // Create corona falloff from center - smoother transition
          float coronaFalloff = 1.0 - smoothstep(0.25, 0.5, dist)
          float gasIntensity = gasNoise * coronaFalloff
          
          // Improved plasma colors that blend with sun
          vec3 innerPlasma = vec3(1.0, 0.7, 0.3) // Orange inner
          vec3 outerPlasma = vec3(1.0, 0.4, 0.1) // Red outer
          
          vec3 gasColor = mix(outerPlasma, innerPlasma, coronaFalloff)
          
          // Calculate opacity - much smoother blending
          float opacity = gasIntensity * coronaFalloff * 0.4
          opacity *= smoothstep(0.5, 0.15, dist) // Smoother fade at edges
          
          gl_FragColor = vec4(gasColor, opacity)
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false, // Important for proper blending
      blending: THREE.AdditiveBlending // Additive blending for glowing effect
    })
    const corona = new THREE.Mesh(coronaGeometry, coronaMaterial)
    corona.position.set(50, 30, 0)
    scene.add(corona)
    
    // Store reference to corona for updates
    sunRef.current.corona = corona

    // Create moon with improved craters and realistic surface
    const moonGeometry = new THREE.SphereGeometry(2, 16, 12)
    const moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        sunPosition: { value: new THREE.Vector3(50, 30, 0) }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 sunPosition;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        
        // Noise function for surface texture
        float noise(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }
        
        float smoothNoise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          
          float a = noise(i);
          float b = noise(i + vec2(1.0, 0.0));
          float c = noise(i + vec2(0.0, 1.0));
          float d = noise(i + vec2(1.0, 1.0));
          
          vec2 u = f * f * (3.0 - 2.0 * f);
          
          return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        
        void main() {
          // Calculate moon phase based on sun position
          vec3 moonToSun = normalize(sunPosition - vWorldPosition);
          float phase = dot(vNormal, moonToSun);
          
          // Create detailed crater texture
          vec2 craterUv = vUv * 6.0; // More detailed mapping
          
          // Large craters
          float crater1 = 1.0 - smoothstep(0.2, 0.6, length(craterUv - vec2(2.0, 3.0)));
          float crater2 = 1.0 - smoothstep(0.15, 0.5, length(craterUv - vec2(4.0, 1.0)));
          float crater3 = 1.0 - smoothstep(0.25, 0.7, length(craterUv - vec2(1.0, 5.0)));
          float crater4 = 1.0 - smoothstep(0.1, 0.4, length(craterUv - vec2(5.0, 4.0)));
          
          // Medium craters
          float crater5 = 1.0 - smoothstep(0.08, 0.3, length(craterUv - vec2(3.5, 2.0)));
          float crater6 = 1.0 - smoothstep(0.12, 0.35, length(craterUv - vec2(0.5, 3.5)));
          float crater7 = 1.0 - smoothstep(0.06, 0.25, length(craterUv - vec2(4.5, 5.5)));
          
          // Small craters using noise
          float smallCraters = smoothNoise(craterUv * 2.0) * 0.3;
          smallCraters += smoothNoise(craterUv * 4.0) * 0.15;
          
          // Combine all crater effects
          float largeCraters = crater1 * 0.4 + crater2 * 0.35 + crater3 * 0.45 + crater4 * 0.25;
          float mediumCraters = crater5 * 0.2 + crater6 * 0.3 + crater7 * 0.15;
          float allCraters = largeCraters + mediumCraters + smallCraters;
          
          // Add surface roughness
          float surfaceNoise = smoothNoise(craterUv * 8.0) * 0.1;
          float fineDetail = smoothNoise(craterUv * 16.0) * 0.05;
          
          // Moon base color with realistic variations
          vec3 moonBaseColor = vec3(0.75, 0.75, 0.8); // Slightly blue-gray
          vec3 craterColor = vec3(0.5, 0.5, 0.55);    // Darker gray for craters
          
          // Apply crater coloring
          vec3 moonColor = mix(moonBaseColor, craterColor, allCraters);
          
          // Add surface detail
          moonColor += surfaceNoise * 0.1;
          moonColor += fineDetail * 0.05;
          
          // Calculate realistic lighting
          float brightness = max(0.05, phase * 0.9 + 0.1); // Softer lighting
          
          gl_FragColor = vec4(moonColor * brightness, 1.0);
        }
      `,
      side: THREE.DoubleSide
    })
    const moon = new THREE.Mesh(moonGeometry, moonMaterial)
    moon.position.set(-50, 30, 0)
    moonRef.current = moon
    scene.add(moon)

    // Create stars using Points
    const starVertices = []
    const starColors = []
    const starSizes = []
    const numStars = 800 // Reduced for better performance and visibility

    for (let i = 0; i < numStars; i++) {
      // Generate random positions on a sphere, naturally distributed across the visible sky
      const starPhi = Math.random() * Math.PI * 2 // Full horizontal rotation (0 to 2π)
      
      // Use a weighted distribution that favors mid-sky over horizon and zenith
      // This creates a more natural star distribution
      let starTheta = Math.random()
      starTheta = Math.pow(starTheta, 0.7) // Weight towards smaller values (higher in sky)
      starTheta = starTheta * Math.PI * 0.65 + 0.15 // Range from 0.15π to 0.8π (avoid extreme zenith and horizon)
      
      const radius = 400 // Fixed distance for consistency
      const x = radius * Math.sin(starTheta) * Math.cos(starPhi)
      const y = radius * Math.cos(starTheta) // Natural spherical Y coordinate
      const z = radius * Math.sin(starTheta) * Math.sin(starPhi)
      
      // Only add stars that are naturally above horizon (y > 15)
      if (y > 15) {
        starVertices.push(x, y, z)
        
        // Simpler star colors
        const colorType = Math.random()
        if (colorType < 0.7) {
          starColors.push(1.0, 1.0, 1.0) // White
        } else if (colorType < 0.9) {
          starColors.push(0.9, 0.9, 1.0) // Blue-white
        } else {
          starColors.push(1.0, 0.9, 0.7) // Yellow-white
        }
        
        // Random sizes
        starSizes.push(2 + Math.random() * 3)
      }
    }

    const starsGeometry = new THREE.BufferGeometry()
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3))
    starsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3))
    starsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1))

    // Simplified star material that actually works
    const starsMaterial = new THREE.PointsMaterial({
      size: 3,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    })

    const stars = new THREE.Points(starsGeometry, starsMaterial)
    stars.frustumCulled = false // Stars cover whole sky
    starsRef.current = stars
    scene.add(stars)

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 1024 // Increased back from 512
    directionalLight.shadow.mapSize.height = 1024 // Increased back from 512
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 100
    directionalLight.shadow.camera.left = -20
    directionalLight.shadow.camera.right = 20
    directionalLight.shadow.camera.top = 20
    directionalLight.shadow.camera.bottom = -20
    directionalLight.shadow.bias = -0.0001
    scene.add(directionalLight)

    // Camera rotation variables
    let phi = 0 // Horizontal rotation
    let theta = 0 // Vertical rotation

    // Movement speed
    const moveSpeed = 0.1

    // Input handlers
    const handleKeyDown = (event) => {
      keysRef.current[event.code.toLowerCase()] = true
      
      // Handle terraform tool toggle
      if (event.code.toLowerCase() === 'keyt') {
        const newEquippedState = !terraformToolRef.current.equipped
        terraformToolRef.current.equipped = newEquippedState
        setTerraformToolEquipped(newEquippedState)
        
        // Disable other tools
        if (newEquippedState) {
          landLevelToolRef.current.equipped = false
          setLandLevelToolEquipped(false)
        } else {
          // Clear terraform highlights when disabling terraform tool
          landLevelToolRef.current.rectangles.forEach(rect => {
            if (rect.material.emissive.getHex() === 0x001100) {
              rect.material.emissive.setHex(0x000000)
            }
          })
        }
        
        // Update cursor appearance based on tool state
        if (newEquippedState) {
          document.body.style.cursor = 'crosshair'
        } else {
          document.body.style.cursor = 'default'
        }
      }
      
      // Handle auto terrain generation toggle
      if (event.code.toLowerCase() === 'keyy') {
        setShowAutoTerrainModal(true)
      }
      
      // Handle land level tool toggle
      if (event.code.toLowerCase() === 'keyl') {
        const newEquippedState = !landLevelToolRef.current.equipped
        landLevelToolRef.current.equipped = newEquippedState
        setLandLevelToolEquipped(newEquippedState)
        
        // Disable other tools
        if (newEquippedState) {
          terraformToolRef.current.equipped = false
          setTerraformToolEquipped(false)
          
          // Clear terraform highlights when switching to land level tool
          landLevelToolRef.current.rectangles.forEach(rect => {
            if (rect.material.emissive.getHex() === 0x001100) {
              rect.material.emissive.setHex(0x000000)
            }
          })
        }
        
        // Reset land level tool state
        landLevelToolRef.current.state = 'idle'
        landLevelToolRef.current.startPoint = null
        landLevelToolRef.current.endPoint = null
        if (landLevelToolRef.current.previewMesh) {
          scene.remove(landLevelToolRef.current.previewMesh)
          landLevelToolRef.current.previewMesh = null
        }
        if (landLevelToolRef.current.wireframeMesh) {
          scene.remove(landLevelToolRef.current.wireframeMesh)
          landLevelToolRef.current.wireframeMesh = null
        }
        
        // Update cursor appearance based on tool state
        if (newEquippedState) {
          document.body.style.cursor = 'crosshair'
        } else {
          document.body.style.cursor = 'default'
        }
      }
    }

    const handleKeyUp = (event) => {
      keysRef.current[event.code.toLowerCase()] = false
    }

    const handleMouseDown = (event) => {
      if (event.button === 2) { // Right mouse button
        mouseRef.current.isDown = true
        mouseRef.current.lastX = event.clientX
        mouseRef.current.lastY = event.clientY
        event.preventDefault()
      } else if (event.button === 0) { // Left mouse button
        // Check if clicking on a land leveling rectangle first (if not using land leveling tool)
        if (!landLevelToolRef.current.equipped && !terraformToolRef.current.equipped) {
          const raycaster = new THREE.Raycaster()
          raycaster.setFromCamera(mousePositionRef.current, camera)
          
          // Check intersection with land leveling rectangles
          if (landLevelToolRef.current.rectangles.length > 0) {
            const intersects = raycaster.intersectObjects(landLevelToolRef.current.rectangles)
            if (intersects.length > 0) {
              const clickedRectangle = intersects[0].object
              
              // Reset previous selection highlight
              if (landLevelToolRef.current.selectedRectangle) {
                landLevelToolRef.current.selectedRectangle.material.emissive.setHex(0x000000)
              }
              
              landLevelToolRef.current.selectedRectangle = clickedRectangle
              setSelectedBlock(clickedRectangle)
              setEditingHeight(clickedRectangle.geometry.parameters.height) // Get current height from geometry
              setShowHeightEditor(true)
              
              // Add selection highlight
              clickedRectangle.material.emissive.setHex(0x444444) // Stronger highlight for selection
              
              event.preventDefault()
              return
            }
          }
        }
        
        // Start terraforming only if terraform tool is equipped
        if (terraformToolRef.current.equipped) {
          terraformingRef.current.isActive = true
          terraformingRef.current.lastPosition = null
        }
        // Handle land level tool interaction
        else if (landLevelToolRef.current.equipped) {
          if (landLevelToolRef.current.state === 'idle') {
            // Start: set first corner
            landLevelToolRef.current.state = 'first-corner'
            landLevelToolRef.current.startPoint = null
            landLevelToolRef.current.endPoint = null
          } else if (landLevelToolRef.current.state === 'first-corner') {
            // Set second corner and show wireframe preview
            landLevelToolRef.current.state = 'second-corner'
          } else if (landLevelToolRef.current.state === 'second-corner') {
            // Start height adjustment mode
            landLevelToolRef.current.state = 'height-adjust'
            landLevelToolRef.current.heightAdjustStartY = event.clientY
            landLevelToolRef.current.baseHeight = 1
          } else if (landLevelToolRef.current.state === 'height-adjust') {
            // Finalize the rectangle
            landLevelToolRef.current.state = 'idle'
            if (landLevelToolRef.current.previewMesh) {
              // Convert preview to permanent rectangle
              const geometry = landLevelToolRef.current.previewMesh.geometry.clone()
              const material = new THREE.MeshLambertMaterial({ color: 0x00aa00 })
              const permanentMesh = new THREE.Mesh(geometry, material)
              permanentMesh.position.copy(landLevelToolRef.current.previewMesh.position)
              permanentMesh.castShadow = true
              permanentMesh.receiveShadow = true
              scene.add(permanentMesh)
              landLevelToolRef.current.rectangles.push(permanentMesh)
              
              // Remove preview and wireframe
              scene.remove(landLevelToolRef.current.previewMesh)
              if (landLevelToolRef.current.wireframeMesh) {
                scene.remove(landLevelToolRef.current.wireframeMesh)
                landLevelToolRef.current.wireframeMesh = null
              }
              landLevelToolRef.current.previewMesh = null
            }
            // Reset points for next rectangle
            landLevelToolRef.current.startPoint = null
            landLevelToolRef.current.endPoint = null
          }
        }
        event.preventDefault()
      }
    }

    const handleMouseUp = (event) => {
      if (event.button === 2) {
        mouseRef.current.isDown = false
      } else if (event.button === 0) { // Left mouse button
        // Stop terraforming
        terraformingRef.current.isActive = false
        terraformingRef.current.lastPosition = null
        
        // Handle land level tool rectangle selection
        if (landLevelToolRef.current.equipped && landLevelToolRef.current.state === 'height-adjust') {
          // Only handle mouse up during height adjustment to allow camera movement
        }
      }
    }

    const handleMouseMove = (event) => {
      if (mouseRef.current.isDown) {
        const deltaX = event.clientX - mouseRef.current.lastX
        const deltaY = event.clientY - mouseRef.current.lastY

        phi -= deltaX * 0.005
        theta -= deltaY * 0.005
        theta = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, theta))

        mouseRef.current.lastX = event.clientX
        mouseRef.current.lastY = event.clientY
      }
    }

    const handleContextMenu = (event) => {
      event.preventDefault()
    }

    const handleMouseMoveGeneral = (event) => {
      // Update mouse position for cursor sphere placement
      const rect = renderer.domElement.getBoundingClientRect()
      mousePositionRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mousePositionRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mousemove', handleMouseMoveGeneral) // Add general mouse move listener
    window.addEventListener('contextmenu', handleContextMenu)

    // Animation loop
    let lastTime = performance.now();
    let frameCount = 0;
    const animate = () => {
      requestAnimationFrame(animate)

      const currentTime = performance.now();
      const deltaTime = (currentTime - lastTime) / 1000; // deltaTime in seconds
      lastTime = currentTime;
      frameCount++;

      // Update FPS counter every second and track performance
      if (currentTime >= (animate.lastFpsUpdateTime || 0) + 1000) {
        if (fpsRef.current) {
          const fps = frameCount / ((currentTime - (animate.lastFpsUpdateTime || currentTime - 1000)) / 1000);
          fpsRef.current.textContent = `FPS: ${fps.toFixed(1)}`;
          
          // Track performance for adaptive optimization
          performanceRef.current.fpsHistory.push(fps)
          if (performanceRef.current.fpsHistory.length > 5) {
            performanceRef.current.fpsHistory.shift() // Keep only last 5 measurements
          }
          performanceRef.current.averageFPS = performanceRef.current.fpsHistory.reduce((a, b) => a + b, 0) / performanceRef.current.fpsHistory.length
        }
        animate.lastFpsUpdateTime = currentTime;
        frameCount = 0;
      }

      // Update camera rotation
      camera.rotation.order = 'YXZ'
      camera.rotation.y = phi
      camera.rotation.x = theta

      // Calculate movement direction based on camera rotation
      const direction = new THREE.Vector3()
      camera.getWorldDirection(direction)
      
      const right = new THREE.Vector3()
      right.crossVectors(direction, camera.up).normalize()

      // Handle movement
      if (keysRef.current['keyw']) {
        camera.position.add(direction.multiplyScalar(moveSpeed))
      }
      if (keysRef.current['keys']) {
        camera.position.add(direction.multiplyScalar(-moveSpeed))
      }
      if (keysRef.current['keya']) {
        camera.position.add(right.multiplyScalar(-moveSpeed))
      }
      if (keysRef.current['keyd']) {
        camera.position.add(right.multiplyScalar(moveSpeed))
      }
      
      // Vertical movement
      if (keysRef.current['space']) {
        camera.position.y += moveSpeed
      }
      if (keysRef.current['shiftleft'] || keysRef.current['shiftright']) {
        camera.position.y -= moveSpeed
      }
      
      // Day/night cycle controls
      if (keysRef.current['keyn']) {
        dayNightRef.current.time += deltaTime * 0.5 // Speed up night (reduced from 2)
      }
      if (keysRef.current['keym']) {
        dayNightRef.current.time -= deltaTime * 0.5 // Speed up day (reduced from 2)
      }
      
      // Clear terraform spheres (C key for performance management)
      if (keysRef.current['keyc']) {
        if (terraformingRef.current.instancedMesh) {
          terraformingRef.current.sphereCount = 0
          terraformingRef.current.instancedMesh.count = 0
          terraformingRef.current.positions = []
          terraformingRef.current.instancedMesh.instanceMatrix.needsUpdate = true
          // Reset bounding sphere when clearing
          terraformingRef.current.instancedMesh.computeBoundingSphere()
        }
      }

      // Update cursor sphere position based on mouse raycast (less frequent for performance)
      if (frameCountRef.current % 2 === 0) { // Only update every other frame
        const raycaster = new THREE.Raycaster()
        raycaster.setFromCamera(mousePositionRef.current, camera)
        
        // Check hover on land leveling rectangles (when no tool is equipped)
        if (!landLevelToolRef.current.equipped && !terraformToolRef.current.equipped && landLevelToolRef.current.rectangles.length > 0) {
          const intersects = raycaster.intersectObjects(landLevelToolRef.current.rectangles)
          
          // Reset previous hover state (but not if it's the selected rectangle)
          if (landLevelToolRef.current.hoveredRectangle && landLevelToolRef.current.hoveredRectangle !== landLevelToolRef.current.selectedRectangle) {
            landLevelToolRef.current.hoveredRectangle.material.emissive.setHex(0x000000)
            landLevelToolRef.current.hoveredRectangle = null
          }
          
          // Set new hover state
          if (intersects.length > 0) {
            const hoveredRectangle = intersects[0].object
            if (hoveredRectangle !== landLevelToolRef.current.selectedRectangle) {
              landLevelToolRef.current.hoveredRectangle = hoveredRectangle
              hoveredRectangle.material.emissive.setHex(0x222222) // Subtle highlight for hover
            }
            document.body.style.cursor = 'pointer'
          } else {
            document.body.style.cursor = 'default'
          }
        }
        
        // Create list of objects to intersect with for terraforming
        const terraformableObjects = []
        if (platformRef.current) {
          terraformableObjects.push(platformRef.current)
        }
        // Add generated terrain mesh as terraformable surface
        if (terrainMeshRef.current) {
          terraformableObjects.push(terrainMeshRef.current)
        }
        // Add land-leveled rectangles as terraformable surfaces
        if (landLevelToolRef.current.rectangles.length > 0) {
          terraformableObjects.push(...landLevelToolRef.current.rectangles)
        }
        
        if (terraformableObjects.length > 0) {
          const intersects = raycaster.intersectObjects(terraformableObjects)
          if (intersects.length > 0) {
            const intersectionPoint = intersects[0].point
            const intersectedObject = intersects[0].object
            
            // Position sphere half-buried in the surface (sphere radius is 0.5)
            cursorSphereRef.current.position.set(
              intersectionPoint.x,
              intersectionPoint.y + 0.25, // Half the sphere radius above surface
              intersectionPoint.z
            )
            // Only show cursor sphere when terraform tool is equipped
            cursorSphereRef.current.visible = terraformToolRef.current.equipped
            
            // Add visual feedback for valid terraforming placement
            if (terraformToolRef.current.equipped) {
              // Clear previous highlights first
              landLevelToolRef.current.rectangles.forEach(rect => {
                if (rect !== intersectedObject && rect.material.emissive.getHex() === 0x001100) {
                  rect.material.emissive.setHex(0x000000)
                }
              })
              
              // Highlight the surface that can be terraformed
              if (intersectedObject !== platformRef.current && intersectedObject !== terrainMeshRef.current) {
                // It's a land-leveled rectangle - add subtle highlight
                if (intersectedObject.material.emissive.getHex() === 0x000000) {
                  intersectedObject.material.emissive.setHex(0x001100) // Subtle green tint
                }
              }
            }

            // Handle terraforming while left mouse is pressed
            if (terraformingRef.current.isActive) {
              // ...existing terraforming code...
            }
            
            // Handle terraforming while left mouse is pressed
            if (terraformingRef.current.isActive) {
              const currentPosition = new THREE.Vector3(
                intersectionPoint.x,
                intersectionPoint.y + 0.25,
                intersectionPoint.z
              )

              // Check if we should add a new sphere (either first one or far enough from last)
              let shouldAddSphere = false
              if (!terraformingRef.current.lastPosition) {
                shouldAddSphere = true
              } else {
                const distance = currentPosition.distanceTo(terraformingRef.current.lastPosition)
                if (distance > 0.08) { // Slightly increased distance for better performance
                  shouldAddSphere = true
                }
              }

              if (shouldAddSphere) {
                // Add sphere to instanced mesh instead of creating individual meshes
                // Set matrix for the new sphere instance
                terraformingRef.current.matrix.setPosition(
                  currentPosition.x,
                  currentPosition.y,
                  currentPosition.z
                )
                
                terraformingRef.current.instancedMesh.setMatrixAt(
                  terraformingRef.current.sphereCount, 
                  terraformingRef.current.matrix
                )
                
                // Store position for potential future optimizations
                terraformingRef.current.positions.push(currentPosition.clone())
                
                terraformingRef.current.sphereCount++
                terraformingRef.current.instancedMesh.count = terraformingRef.current.sphereCount
                terraformingRef.current.instancedMesh.instanceMatrix.needsUpdate = true
                
                // Update bounding sphere to ensure proper rendering at all angles
                terraformingRef.current.instancedMesh.computeBoundingSphere()
                
                terraformingRef.current.lastPosition = currentPosition.clone()

                // Trigger shadow map update more frequently for better visual quality
                if (terraformingRef.current.sphereCount % 3 === 0) {
                  shadowUpdateRef.current = frameCountRef.current
                }
              }
            }
            
            // Handle land level tool
            if (landLevelToolRef.current.equipped) {
              if (landLevelToolRef.current.state === 'first-corner') {
                // Set the first corner point
                landLevelToolRef.current.startPoint = new THREE.Vector3(
                  intersectionPoint.x,
                  intersectionPoint.y,
                  intersectionPoint.z
                )
              } else if (landLevelToolRef.current.state === 'second-corner') {
                // Show wireframe preview of the rectangle area
                if (landLevelToolRef.current.startPoint) {
                  landLevelToolRef.current.endPoint = new THREE.Vector3(
                    intersectionPoint.x,
                    intersectionPoint.y,
                    intersectionPoint.z
                  )
                  
                  // Create wireframe preview
                  const start = landLevelToolRef.current.startPoint
                  const end = landLevelToolRef.current.endPoint
                  const width = Math.abs(end.x - start.x)
                  const depth = Math.abs(end.z - start.z)
                  const centerX = (start.x + end.x) / 2
                  const centerZ = (start.z + end.z) / 2
                  
                  // Remove existing wireframe
                  if (landLevelToolRef.current.wireframeMesh) {
                    scene.remove(landLevelToolRef.current.wireframeMesh)
                  }
                  
                  const wireGeometry = new THREE.BoxGeometry(width, 0.1, depth)
                  const wireMaterial = new THREE.MeshBasicMaterial({ 
                    color: 0x00ff00, 
                    transparent: true, 
                    opacity: 0.3,
                    wireframe: true
                  })
                  landLevelToolRef.current.wireframeMesh = new THREE.Mesh(wireGeometry, wireMaterial)
                  landLevelToolRef.current.wireframeMesh.position.set(
                    centerX, 
                    intersectionPoint.y + 0.05, 
                    centerZ
                  )
                  scene.add(landLevelToolRef.current.wireframeMesh)
                }
              } else if (landLevelToolRef.current.state === 'height-adjust') {
                // Adjust height based on mouse Y position - simpler and more intuitive
                if (landLevelToolRef.current.startPoint && landLevelToolRef.current.endPoint) {
                  // Use mouse Y position directly - up = taller, down = shorter
                  const normalizedY = (-mousePositionRef.current.y + 1) / 2 // Convert from -1,1 to 0,1
                  const newHeight = Math.max(0.2, Math.min(6, normalizedY * 5 + 0.2)) // Height range from 0.2 to 5.2
                  landLevelToolRef.current.currentHeight = newHeight
                  
                  // Update preview mesh
                  const start = landLevelToolRef.current.startPoint
                  const end = landLevelToolRef.current.endPoint
                  const width = Math.abs(end.x - start.x)
                  const depth = Math.abs(end.z - start.z)
                  const centerX = (start.x + end.x) / 2
                  const centerZ = (start.z + end.z) / 2
                  
                  // Remove existing preview
                  if (landLevelToolRef.current.previewMesh) {
                    scene.remove(landLevelToolRef.current.previewMesh)
                  }
                  
                  const geometry = new THREE.BoxGeometry(width, newHeight, depth)
                  const material = new THREE.MeshLambertMaterial({ 
                    color: 0x00ff00, 
                    transparent: true, 
                    opacity: 0.8
                  })
                  landLevelToolRef.current.previewMesh = new THREE.Mesh(geometry, material)
                  landLevelToolRef.current.previewMesh.position.set(
                    centerX, 
                    intersectionPoint.y + newHeight / 2, 
                    centerZ
                  )
                  landLevelToolRef.current.previewMesh.castShadow = true
                  scene.add(landLevelToolRef.current.previewMesh)
                }
              }
            }
          } else {
            cursorSphereRef.current.visible = false
            
            // Clear terraform hover highlights when no intersection
            if (terraformToolRef.current.equipped) {
              landLevelToolRef.current.rectangles.forEach(rect => {
                if (rect.material.emissive.getHex() === 0x001100) {
                  rect.material.emissive.setHex(0x000000)
                }
              })
            }
          }
        } else {
          cursorSphereRef.current.visible = false
        }
        
        // Clear terraform hover highlights when terraform tool is not equipped
        if (!terraformToolRef.current.equipped) {
          landLevelToolRef.current.rectangles.forEach(rect => {
            if (rect.material.emissive.getHex() === 0x001100) {
              rect.material.emissive.setHex(0x000000)
            }
          })
        }
      }

      // Increment frame counter
      frameCountRef.current++

      // Day/night cycle (update less frequently for performance)
      if (frameCountRef.current % 2 === 0) { // Update every 2nd frame
        dayNightRef.current.time += deltaTime * 0.1     // Halved cycle speed for more natural pacing
        
        // Calculate cycle progress (0 = midnight, 1 = noon)
        const cycleProgress = (Math.sin(dayNightRef.current.time) + 1) / 2
        
        // Calculate sun and moon angles
        const sunAngle = dayNightRef.current.time
        const moonAngle = dayNightRef.current.time + Math.PI
        
        // Update sun position and visibility
        const sunX = Math.cos(sunAngle) * 100
        const sunY = Math.sin(sunAngle) * 60
        const sunZ = 0
        
        sunRef.current.position.set(sunX, sunY, sunZ)
        sunRef.current.visible = sunY > -10 // Hide sun when too low
        
        // Update corona position and visibility
        if (sunRef.current.corona) {
          sunRef.current.corona.position.set(sunX, sunY, sunZ)
          sunRef.current.corona.visible = sunY > -10
          sunRef.current.corona.material.uniforms.time.value = dayNightRef.current.time
        }
        
        // Update moon position and visibility  
        const moonX = Math.cos(moonAngle) * 100
        const moonY = Math.sin(moonAngle) * 60
        const moonZ = 0
        
        moonRef.current.position.set(moonX, moonY, moonZ)
        moonRef.current.visible = moonY > -10 // Hide moon when too low
        
        // Update skybox uniforms
        if (skyboxRef.current) {
          skyboxRef.current.material.uniforms.time.value = dayNightRef.current.time
          skyboxRef.current.material.uniforms.sunPosition.value.set(sunX, sunY, sunZ)
          skyboxRef.current.material.uniforms.moonPosition.value.set(moonX, moonY, moonZ)
        }
        
        // Update sun shader
        sunRef.current.material.uniforms.time.value = dayNightRef.current.time
        
        // Update moon shader with sun position for phase calculation
        moonRef.current.material.uniforms.time.value = dayNightRef.current.time
        moonRef.current.material.uniforms.sunPosition.value.copy(sunRef.current.position)
        
        // Update directional light (sun) position and intensity
        if (sunY > 0) {
          directionalLight.position.set(sunX, sunY, sunZ)
          directionalLight.intensity = Math.max(0.1, cycleProgress * 1.0)
          
          // Change light color throughout the day
          if (cycleProgress < 0.2 || cycleProgress > 0.8) {
            // Sunrise/sunset - warm orange light
            directionalLight.color.setRGB(1.0, 0.7, 0.4)
          } else {
            // Midday - white light
            directionalLight.color.setRGB(1.0, 1.0, 1.0)
          }
        } else {
          // Moonlight when sun is down
          directionalLight.position.set(moonX, moonY, moonZ)
          directionalLight.intensity = Math.max(0.05, (1 - cycleProgress) * 0.3)
          directionalLight.color.setRGB(0.6, 0.7, 1.0) // Blue moonlight
        }
        
        // Update ambient light intensity and color
        ambientLight.intensity = Math.max(0.05, cycleProgress * 0.3)
        if (cycleProgress > 0.5) {
          // Day time - slightly warm ambient light
          ambientLight.color.setRGB(1.0, 0.95, 0.9)
        } else {
          // Night time - cool ambient light
          ambientLight.color.setRGB(0.7, 0.8, 1.0)
        }
        
        // Update fog color based on time of day
        if (scene.fog) {
          if (cycleProgress > 0.5) {
            // Day time - light blue fog
            scene.fog.color.setRGB(0.53, 0.81, 0.92) // Sky blue
          } else {
            // Night time - dark blue fog
            scene.fog.color.setRGB(0.1, 0.1, 0.3)
          }
        }
        
        // Calculate sky brightness for star visibility
        const skyBrightness = Math.max(0.0, Math.min(1.0, cycleProgress))
        
        // Update stars visibility - simple approach
        if (starsRef.current) {
          // Stars are visible when sky is dark (night time)
          starsRef.current.visible = skyBrightness < 0.3
          // Fade stars based on sky brightness
          starsRef.current.material.opacity = Math.max(0.0, (0.5 - skyBrightness) * 2.0)
        }
      }

      // Update shadows with adaptive frequency based on performance
      const averageFPS = performanceRef.current.averageFPS
      let shadowUpdateFrequency = 8 // Default frequency
      
      // Adapt shadow update frequency based on performance
      if (averageFPS > 50) {
        shadowUpdateFrequency = 4 // More frequent updates when performance is good
      } else if (averageFPS < 30) {
        shadowUpdateFrequency = 12 // Less frequent when performance is poor
      }
      
      const shouldUpdateShadows = (
        frameCountRef.current % shadowUpdateFrequency === 0 || // Adaptive regular updates
        (shadowUpdateRef.current > 0 && frameCountRef.current - shadowUpdateRef.current < 3) || // Recent terraforming
        (terraformingRef.current.isActive && frameCountRef.current % Math.max(2, shadowUpdateFrequency / 2) === 0) // More frequent during active terraforming
      )
      
      if (shouldUpdateShadows) {
        renderer.shadowMap.needsUpdate = true
      } else {
        renderer.shadowMap.needsUpdate = false
      }

      renderer.render(scene, camera)
    }

    animate()

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }

    window.addEventListener('resize', handleResize)

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mousemove', handleMouseMoveGeneral) // Remove general mouse move listener
      window.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('resize', handleResize)
      
      // Reset cursor
      document.body.style.cursor = 'default'
      
      // Clean up terraform instances
      if (terraformingRef.current.instancedMesh) {
        scene.remove(terraformingRef.current.instancedMesh)
        terraformingRef.current.instancedMesh.geometry.dispose()
        terraformingRef.current.instancedMesh.material.dispose()
      }
      
      // Clean up terrain mesh
      if (terrainMeshRef.current) {
        scene.remove(terrainMeshRef.current)
        terrainMeshRef.current.geometry.dispose()
        terrainMeshRef.current.material.dispose()
      }
      
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  // Completely rewritten terrain generation function
  const generateAutoTerrain = async (hilliness) => {
    if (!sceneRef.current || autoTerrainRef.current.generating) {
      return
    }
    
    autoTerrainRef.current.generating = true
    
    try {
      // Remove existing terrain mesh if it exists
      if (terrainMeshRef.current) {
        sceneRef.current.remove(terrainMeshRef.current)
        terrainMeshRef.current.geometry.dispose()
        terrainMeshRef.current.material.dispose()
        terrainMeshRef.current = null
      }
      
      // REMOVE THE BROWN BASE PLATE when generating terrain
      if (platformRef.current) {
        sceneRef.current.remove(platformRef.current)
        platformRef.current.geometry.dispose()
        platformRef.current.material.dispose()
        platformRef.current = null
      }
      
      // Create a large terrain with high resolution for smoothness
      const terrainSize = 50
      const segments = 140 // Higher resolution for smoother terrain
      
      // Create the base plane geometry
      const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments)
      const positionAttribute = geometry.getAttribute('position')
      
      // Advanced noise functions for more realistic terrain
      const smoothNoise = (x, z, frequency) => {
        const xi = Math.floor(x * frequency)
        const zi = Math.floor(z * frequency)
        const xf = (x * frequency) - xi
        const zf = (z * frequency) - zi
        
        // Simple hash function for pseudo-random values
        const hash = (x, z) => {
          let h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
          return (h - Math.floor(h)) * 2 - 1
        }
        
        // Get corner values
        const a = hash(xi, zi)
        const b = hash(xi + 1, zi)
        const c = hash(xi, zi + 1)
        const d = hash(xi + 1, zi + 1)
        
        // Smooth interpolation (smoothstep)
        const sx = xf * xf * (3 - 2 * xf)
        const sz = zf * zf * (3 - 2 * zf)
        
        // Bilinear interpolation
        const i1 = a * (1 - sx) + b * sx
        const i2 = c * (1 - sx) + d * sx
        return i1 * (1 - sz) + i2 * sz
      }
      
      const fractalNoise = (x, z, octaves, persistence, scale) => {
        let value = 0
        let amplitude = 1
        let frequency = scale
        let maxValue = 0
        
        for (let i = 0; i < octaves; i++) {
          value += smoothNoise(x, z, frequency) * amplitude
          maxValue += amplitude
          amplitude *= persistence
          frequency *= 2
        }
        
        return value / maxValue
      }
      
      // Generate sophisticated terrain heights
      for (let i = 0; i < positionAttribute.count; i++) {
        const x = positionAttribute.getX(i)
        const y = positionAttribute.getY(i)
        
        // Multiple noise layers for realistic terrain
        let height = 0
        
        // Base terrain shape (large features)
        height += fractalNoise(x, y, 4, 0.5, 0.01) * 2.0
        
        // Medium hills and valleys
        height += fractalNoise(x, y, 3, 0.6, 0.03) * 1.5
        
        // Small details and bumps
        height += fractalNoise(x, y, 2, 0.4, 0.08) * 0.8
        
        // Fine surface details
        height += fractalNoise(x, y, 1, 0.3, 0.2) * 0.3
        
        // Apply hilliness multiplier more gradually
        // Keep terrain close to ground level (base plate was at y = -0.5)
        const baseLevel = -0.5
        const heightVariation = height * hilliness * 0.8 // Reduced multiplier
        const finalHeight = baseLevel + Math.max(0.1, heightVariation + 0.8)
        
        // Set the Z coordinate (height in PlaneGeometry before rotation)
        positionAttribute.setZ(i, finalHeight)
      }
      
      // Mark the position attribute as needing update
      positionAttribute.needsUpdate = true
      
      // Rotate to horizontal (XZ plane)
      geometry.rotateX(-Math.PI / 2)
      
      // Compute normals for proper lighting
      geometry.computeVertexNormals()
      
      // Create more sophisticated material with brighter color variation
      const material = new THREE.MeshLambertMaterial({ 
        color: 0x4CAF50, // Bright vibrant green
        side: THREE.DoubleSide
      })
      
      // Add vertex colors for more realistic appearance with brighter colors
      const colors = new Float32Array(positionAttribute.count * 3)
      for (let i = 0; i < positionAttribute.count; i++) {
        const height = positionAttribute.getZ(i)
        const normalizedHeight = Math.max(0, Math.min(1, (height + 0.5) / 4))
        
        // Color gradient based on height - much brighter and more vibrant
        if (normalizedHeight < 0.3) {
          // Lower areas - bright grass green
          colors[i * 3] = 0.2 + normalizedHeight * 0.4     // Red
          colors[i * 3 + 1] = 0.7 + normalizedHeight * 0.3 // Green (much brighter)
          colors[i * 3 + 2] = 0.2 + normalizedHeight * 0.3 // Blue
        } else if (normalizedHeight < 0.7) {
          // Mid areas - vibrant green
          colors[i * 3] = 0.3 + normalizedHeight * 0.4     // Red
          colors[i * 3 + 1] = 0.8 + normalizedHeight * 0.2 // Green (very bright)
          colors[i * 3 + 2] = 0.3 + normalizedHeight * 0.3 // Blue
        } else {
          // Higher areas - bright lime green with slight yellow tint
          colors[i * 3] = 0.5 + normalizedHeight * 0.4     // Red (more yellow)
          colors[i * 3 + 1] = 0.9 + normalizedHeight * 0.1 // Green (brightest)
          colors[i * 3 + 2] = 0.4 + normalizedHeight * 0.2 // Blue
        }
      }
      
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      material.vertexColors = true
      
      // Create the terrain mesh
      const terrainMesh = new THREE.Mesh(geometry, material)
      terrainMesh.position.set(0, 0, 0) // Center on the base plate
      terrainMesh.castShadow = true
      terrainMesh.receiveShadow = true
      
      // Add to scene
      sceneRef.current.add(terrainMesh)
      terrainMeshRef.current = terrainMesh
      
      console.log(`Advanced terrain generated with hilliness: ${hilliness}, size: ${terrainSize}x${terrainSize}`)
      
      // Force shadow update
      if (rendererRef.current) {
        rendererRef.current.shadowMap.needsUpdate = true
      }
      
    } catch (error) {
      console.error('Error generating terrain:', error)
    } finally {
      autoTerrainRef.current.generating = false
    }
  }

  // Handle terraform tool toggle function
  const toggleTerraformTool = () => {
    const newEquippedState = !terraformToolEquipped
    terraformToolRef.current.equipped = newEquippedState
    setTerraformToolEquipped(newEquippedState)
    
    // Disable land leveling tool if terraform is being equipped
    if (newEquippedState && landLevelToolEquipped) {
      landLevelToolRef.current.equipped = false
      setLandLevelToolEquipped(false)
    }
    
    // Update cursor appearance based on tool state
    if (newEquippedState) {
      document.body.style.cursor = 'crosshair'
    } else {
      document.body.style.cursor = 'default'
    }
  }

  // Handle land leveling tool toggle function
  const toggleLandLevelingTool = () => {
    const newEquippedState = !landLevelToolEquipped
    landLevelToolRef.current.equipped = newEquippedState
    setLandLevelToolEquipped(newEquippedState)
    
    // Disable terraform tool if land leveling is being equipped
    if (newEquippedState && terraformToolEquipped) {
      terraformToolRef.current.equipped = false
      setTerraformToolEquipped(false)
    }
    
    // Reset land leveling state when toggling
    landLevelToolRef.current.state = 'idle'
    landLevelToolRef.current.startPoint = null
    landLevelToolRef.current.endPoint = null
    if (landLevelToolRef.current.previewMesh) {
      // Remove preview mesh if exists
      if (sceneRef.current) {
        sceneRef.current.remove(landLevelToolRef.current.previewMesh)
      }
      landLevelToolRef.current.previewMesh = null
    }
    if (landLevelToolRef.current.wireframeMesh) {
      // Remove wireframe mesh if exists
      if (sceneRef.current) {
        sceneRef.current.remove(landLevelToolRef.current.wireframeMesh)
      }
      landLevelToolRef.current.wireframeMesh = null
    }
    
    // Update cursor appearance based on tool state
    if (newEquippedState) {
      document.body.style.cursor = 'crosshair'
    } else {
      document.body.style.cursor = 'default'
    }
  }

  // Handle height update for selected block
  const updateBlockHeight = (newHeight) => {
    if (selectedBlock && newHeight > 0) {
      const heightInMeters = parseFloat(newHeight)
      setEditingHeight(heightInMeters)
      
      // Store original Y position (bottom of the block)
      const originalBottomY = selectedBlock.position.y - (selectedBlock.geometry.parameters.height / 2)
      
      // Update the mesh geometry
      const currentGeometry = selectedBlock.geometry
      const width = currentGeometry.parameters.width
      const depth = currentGeometry.parameters.depth
      
      // Create new geometry with updated height
      const newGeometry = new THREE.BoxGeometry(width, heightInMeters, depth)
      selectedBlock.geometry.dispose() // Clean up old geometry
      selectedBlock.geometry = newGeometry
      
      // Position the block so its bottom stays at the same level
      selectedBlock.position.y = originalBottomY + (heightInMeters / 2)
      
      // Update shadow map
      shadowUpdateRef.current = frameCountRef.current
    }
  }

  // Close height editor
  const closeHeightEditor = () => {
    // Reset selection highlight
    if (landLevelToolRef.current.selectedRectangle) {
      landLevelToolRef.current.selectedRectangle.material.emissive.setHex(0x000000)
    }
    
    setShowHeightEditor(false)
    setSelectedBlock(null)
    landLevelToolRef.current.selectedRectangle = null
  }

  return (
    <div style={{ 
      margin: 0, 
      padding: 0, 
      overflow: 'hidden',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      MozUserSelect: 'none',
      msUserSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitTapHighlightColor: 'transparent'
    }}>
      <div 
        ref={mountRef} 
        style={{ width: '100vw', height: '100vh', display: 'block' }}
      />
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        color: 'white',
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '10px',
        borderRadius: '5px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        pointerEvents: 'none'
      }}>
        <div>WASD: Move</div>
        <div>Space: Move Up</div>
        <div>Shift: Move Down</div>
        <div>Right Click + Drag: Look Around</div>
        <div>Left Click + Drag: Terraform (when equipped)</div>
        <div>Left Click: Land Leveling - 1) First corner 2) Second corner 3) Adjust height 4) Finalize</div>
        <div>N: Speed up time (night)</div>
        <div>M: Slow down time (day)</div>
        <div>T: Toggle Terraform Tool</div>
        <div>L: Toggle Land Leveling Tool</div>
        <div>Y: Auto Terrain Generation</div>
        <div>C: Clear terraform spheres</div>
        <div ref={fpsRef}>FPS: ...</div> {/* FPS display element */}
      </div>
      
      {/* Terraform Tool Button */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }}>
        <button
          onClick={toggleTerraformTool}
          style={{
            width: '60px',
            height: '60px',
            backgroundColor: terraformToolEquipped ? '#4CAF50' : 'rgba(0,0,0,0.7)',
            border: terraformToolEquipped ? '3px solid #81C784' : '2px solid #666',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            transform: terraformToolEquipped ? 'scale(1.1)' : 'scale(1)',
            boxShadow: terraformToolEquipped ? '0 0 15px rgba(76, 175, 80, 0.5)' : '0 2px 5px rgba(0,0,0,0.3)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none'
          }}
          onMouseEnter={(e) => {
            if (!terraformToolEquipped) {
              e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'
            }
          }}
          onMouseLeave={(e) => {
            if (!terraformToolEquipped) {
              e.target.style.backgroundColor = 'rgba(0,0,0,0.7)'
            }
          }}
        >
          <div style={{ fontSize: '20px', marginBottom: '2px' }}>🔨</div>
          <div style={{ fontSize: '10px' }}>T</div>
        </button>

        <button
          onClick={toggleLandLevelingTool}
          style={{
            width: '60px',
            height: '60px',
            backgroundColor: landLevelToolEquipped ? '#4CAF50' : 'rgba(0,0,0,0.7)',
            border: landLevelToolEquipped ? '3px solid #81C784' : '2px solid #666',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            transform: landLevelToolEquipped ? 'scale(1.1)' : 'scale(1)',
            boxShadow: landLevelToolEquipped ? '0 0 15px rgba(76, 175, 80, 0.5)' : '0  2px 5px rgba(0,0,0,0.3)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none'
          }}
          onMouseEnter={(e) => {
            if (!landLevelToolEquipped) {
              e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'
            }
          }}
          onMouseLeave={(e) => {
            if (!landLevelToolEquipped) {
              e.target.style.backgroundColor = 'rgba(0,0,0,0.7)'
            }
          }}
        >
          <div style={{ fontSize: '20px', marginBottom: '2px' }}>📐</div>
          <div style={{ fontSize: '10px' }}>L</div>
        </button>

        <button
          onClick={() => setShowAutoTerrainModal(true)}
          style={{
            width: '60px',
            height: '60px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            border: '2px solid #666',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            transform: 'scale(1)',
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none'
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'rgba(0,0,0,0.7)'
          }}
        >
          <div style={{ fontSize: '20px', marginBottom: '2px' }}>🏔️</div>
          <div style={{ fontSize: '10px' }}>Y</div>
        </button>
      </div>

      {/* Height Editor Modal */}
      {showHeightEditor && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0,0,0,0.9)',
          border: '2px solid #4CAF50',
          borderRadius: '10px',
          padding: '20px',
          color: 'white',
          fontFamily: 'Arial, sans-serif',
          minWidth: '300px',
          zIndex: 1000,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none'
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#4CAF50' }}>Edit Block Height</h3>
          
          {selectedBlock && (
            <div style={{ marginBottom: '15px', fontSize: '12px', color: '#ccc' }}>
              <div>Width: {selectedBlock.geometry.parameters.width.toFixed(2)}m</div>
              <div>Depth: {selectedBlock.geometry.parameters.depth.toFixed(2)}m</div>
              <div>Current Height: {selectedBlock.geometry.parameters.height.toFixed(2)}m</div>
            </div>
          )}
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
              Height (meters):
            </label>
            <input
              ref={(input) => input && input.focus()} // Auto-focus when modal opens
              type="number"
              value={editingHeight}
              onChange={(e) => {
                const newValue = parseFloat(e.target.value)
                if (!isNaN(newValue) && newValue > 0) {
                  setEditingHeight(newValue)
                } else if (e.target.value === '') {
                  setEditingHeight('')
                }
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  const height = typeof editingHeight === 'number' ? editingHeight : parseFloat(editingHeight)
                  if (!isNaN(height) && height > 0) {
                    updateBlockHeight(height)
                    closeHeightEditor() // Close modal after applying
                  }
                }
              }}
              step="0.1"
              min="0.1"
              max="10"
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #666',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: 'white',
                fontSize: '14px',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                MozUserSelect: 'text',
                msUserSelect: 'text'
              }}
            />
          </div>
          
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={closeHeightEditor}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid #666',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none'
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const height = typeof editingHeight === 'number' ? editingHeight : parseFloat(editingHeight)
                if (!isNaN(height) && height > 0) {
                  updateBlockHeight(height)
                  closeHeightEditor() // Close modal after applying
                }
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: '#4CAF50',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none'
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
      
      {/* Auto Terrain Generation Modal */}
      {showAutoTerrainModal && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0,0,0,0.9)',
          border: '2px solid #4CAF50',
          borderRadius: '10px',
          padding: '20px',
          color: 'white',
          fontFamily: 'Arial, sans-serif',
          minWidth: '350px',
          zIndex: 1000,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none'
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#4CAF50' }}>Auto Terrain Generation</h3>
          
          <div style={{ marginBottom: '15px', fontSize: '12px', color: '#ccc' }}>
            Generate smooth procedural terrain using displacement mapping based on noise patterns.
          </div>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
              Hilliness Level:
            </label>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.1"
              value={autoTerrainHilliness}
              onChange={(e) => setAutoTerrainHilliness(parseFloat(e.target.value))}
              style={{
                width: '100%',
                height: '20px',
                marginBottom: '10px',
                accentColor: '#4CAF50',
                backgroundColor: '#333',
                outline: 'none',
                cursor: 'pointer'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ccc' }}>
              <span>Flat (0.5)</span>
              <span>Current: {autoTerrainHilliness.toFixed(1)}</span>
              <span>Very Hilly (5.0)</span>
            </div>
          </div>
          
          <div style={{ marginBottom: '15px', fontSize: '12px', color: '#ffcc00' }}>
            ⚠️ This will replace any existing terrain with a new smooth landscape.
          </div>
          
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowAutoTerrainModal(false)}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: '1px solid #666',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: 'white',
                cursor: 'pointer',
                fontSize: '14px',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none'
              }}
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setShowAutoTerrainModal(false)
                await generateAutoTerrain(autoTerrainHilliness)
              }}
              disabled={autoTerrainRef.current.generating}
              style={{
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: autoTerrainRef.current.generating ? '#666' : '#4CAF50',
                color: 'white',
                cursor: autoTerrainRef.current.generating ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none'
              }}
            >
              {autoTerrainRef.current.generating ? 'Generating...' : 'Generate Terrain'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home





