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

  useEffect(() => {
    if (!mountRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87CEEB) // Sky blue
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
      antialias: false, // Changed: Disabled antialiasing for performance
      powerPreference: 'high-performance' // Added for performance
    })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // Added for performance
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap // Changed from PCFSoftShadowMap for performance
    rendererRef.current = renderer
    mountRef.current.appendChild(renderer.domElement)

    // Create platform
    const platformGeometry = new THREE.BoxGeometry(20, 1, 20)
    const platformMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
    const platform = new THREE.Mesh(platformGeometry, platformMaterial)
    platform.position.y = -0.5
    platform.receiveShadow = true
    scene.add(platform)

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

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 1024 // Reduced from 2048 for performance
    directionalLight.shadow.mapSize.height = 1024 // Reduced from 2048 for performance
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
      }
    }

    const handleMouseUp = (event) => {
      if (event.button === 2) {
        mouseRef.current.isDown = false
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

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('mousemove', handleMouseMove)
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
        <div ref={fpsRef}>FPS: ...</div> {/* FPS display element */}
      </div>
    </div>
  )
}

export default Home


