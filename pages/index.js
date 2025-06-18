import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function Home() {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const keysRef = useRef({})
  const mouseRef = useRef({ isDown: false, lastX: 0, lastY: 0 })
  const fpsRef = useRef(null); // Ref for the FPS display element
  const cursorSphereRef = useRef(null); // Ref for the cursor sphere
  const platformRef = useRef(null); // Ref for the platform mesh
  const mousePositionRef = useRef({ x: 0, y: 0 }); // Mouse position in normalized coordinates
  const terraformingRef = useRef({ 
    isActive: false, 
    lastPosition: null, 
    spheres: [] 
  }); // Terraforming state
  const sunRef = useRef(null); // Sun reference
  const moonRef = useRef(null); // Moon reference
  const starsRef = useRef(null); // Stars reference
  const skyboxRef = useRef(null); // Skybox reference
  const dayNightRef = useRef({ time: 0 }); // Day/night cycle time
  const frameCountRef = useRef(0); // Frame counter for optimization
  const shadowUpdateRef = useRef(0); // Shadow update counter

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

    // Add some cubes for reference using InstancedMesh
    const numCubes = 10;
    const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
    const cubeMaterial = new THREE.MeshLambertMaterial(); // Material will be colored per instance
    const instancedCube = new THREE.InstancedMesh(cubeGeometry, cubeMaterial, numCubes);
    instancedCube.castShadow = true;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < numCubes; i++) {
      matrix.setPosition(
        (Math.random() - 0.5) * 18,
        0.5,
        (Math.random() - 0.5) * 18
      );
      instancedCube.setMatrixAt(i, matrix);
      instancedCube.setColorAt(i, color.setHex(Math.random() * 0xffffff));
    }
    scene.add(instancedCube)

    // Create sun with improved appearance
    const sunGeometry = new THREE.SphereGeometry(3, 16, 12)
    const sunMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        
        void main() {
          vec2 center = vUv - 0.5;
          float dist = length(center);
          
          // Create sun surface with slight animation
          float surface = 1.0 - smoothstep(0.45, 0.5, dist);
          float glow = 1.0 - smoothstep(0.3, 0.7, dist);
          
          // Add some surface detail
          float detail = sin(time * 2.0 + vUv.x * 20.0) * sin(time * 1.5 + vUv.y * 25.0) * 0.1;
          
          vec3 sunColor = vec3(1.0, 0.9, 0.3) + detail * 0.2;
          float alpha = surface + glow * 0.3;
          
          gl_FragColor = vec4(sunColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    })
    const sun = new THREE.Mesh(sunGeometry, sunMaterial)
    sun.position.set(50, 30, 0)
    sunRef.current = sun
    scene.add(sun)

    // Create moon with improved appearance and phases
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
        
        void main() {
          // Calculate moon phase based on sun position
          vec3 moonToSun = normalize(sunPosition - vWorldPosition);
          float phase = dot(vNormal, moonToSun);
          
          // Create moon surface with craters
          vec2 craterUv = vUv * 3.0;
          float crater1 = 1.0 - smoothstep(0.3, 0.5, length(craterUv - vec2(1.0, 1.5)));
          float crater2 = 1.0 - smoothstep(0.2, 0.4, length(craterUv - vec2(2.0, 0.5)));
          float crater3 = 1.0 - smoothstep(0.15, 0.3, length(craterUv - vec2(0.5, 2.0)));
          
          float craters = crater1 * 0.3 + crater2 * 0.2 + crater3 * 0.25;
          
          // Moon color with realistic shading
          vec3 moonColor = vec3(0.8, 0.8, 0.9) - craters * 0.4;
          float brightness = max(0.1, phase);
          
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
      // Generate random positions on a sphere, but only above horizon
      const phi = Math.random() * Math.PI * 2
      const theta = Math.random() * Math.PI * 0.5 // Only upper hemisphere (0 to PI/2)
      
      const radius = 400 // Fixed distance for consistency
      const x = radius * Math.sin(theta) * Math.cos(phi)
      const y = Math.abs(radius * Math.cos(theta)) + 50 // Ensure stars are above horizon
      const z = radius * Math.sin(theta) * Math.sin(phi)
      
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
        // Start terraforming
        terraformingRef.current.isActive = true
        terraformingRef.current.lastPosition = null
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

      // Update FPS counter every second
      if (currentTime >= (animate.lastFpsUpdateTime || 0) + 1000) {
        if (fpsRef.current) {
          const fps = frameCount / ((currentTime - (animate.lastFpsUpdateTime || currentTime - 1000)) / 1000);
          fpsRef.current.textContent = `FPS: ${fps.toFixed(1)}`;
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
        dayNightRef.current.time += deltaTime * 2 // Speed up night
      }
      if (keysRef.current['keym']) {
        dayNightRef.current.time -= deltaTime * 2 // Speed up day
      }

      // Update cursor sphere position based on mouse raycast
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mousePositionRef.current, camera)
      
      if (platformRef.current) {
        const intersects = raycaster.intersectObject(platformRef.current)
        if (intersects.length > 0) {
          const intersectionPoint = intersects[0].point
          // Position sphere half-buried in the surface (sphere radius is 0.5)
          cursorSphereRef.current.position.set(
            intersectionPoint.x,
            intersectionPoint.y + 0.25, // Half the sphere radius above surface
            intersectionPoint.z
          )
          cursorSphereRef.current.visible = true

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
              if (distance > 0.05) { // Reduced from 0.1 for higher frequency
                shouldAddSphere = true
              }
            }

            if (shouldAddSphere) {
              // Create a new terraforming sphere with optimized geometry
              const terraformGeometry = new THREE.SphereGeometry(0.5, 8, 6) // Reduced from 16,16
              const terraformMaterial = new THREE.MeshLambertMaterial({ 
                color: 0x00aa00 // Slightly darker green for permanence
              })
              const terraformSphere = new THREE.Mesh(terraformGeometry, terraformMaterial)
              terraformSphere.position.copy(currentPosition)
              terraformSphere.castShadow = true
              terraformSphere.receiveShadow = true
              terraformSphere.frustumCulled = true // Enable frustum culling
              
              scene.add(terraformSphere)
              terraformingRef.current.spheres.push(terraformSphere)
              terraformingRef.current.lastPosition = currentPosition.clone()

              // Trigger shadow map update
              shadowUpdateRef.current = frameCountRef.current
            }
          }
        } else {
          cursorSphereRef.current.visible = false
        }
      }

      // Increment frame counter
      frameCountRef.current++

      // Day/night cycle (update less frequently for performance)
      if (frameCountRef.current % 2 === 0) { // Update every 2nd frame
        dayNightRef.current.time += deltaTime * 0.2 * 2 // Faster cycle for demonstration, compensate for reduced frequency
        
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

      // Update shadows only when needed (every 10 frames or when terraforming)
      if (frameCountRef.current % 10 === 0 || 
          (shadowUpdateRef.current > 0 && frameCountRef.current - shadowUpdateRef.current < 5)) {
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
      
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  return (
    <div style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
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
        borderRadius: '5px'
      }}>
        <div>WASD: Move</div>
        <div>Space: Move Up</div>
        <div>Shift: Move Down</div>
        <div>Right Click + Drag: Look Around</div>
        <div>Left Click + Drag: Terraform</div>
        <div>N: Speed up time (night)</div>
        <div>M: Slow down time (day)</div>
        <div ref={fpsRef}>FPS: ...</div> {/* FPS display element */}
      </div>
    </div>
  )
}

export default Home



