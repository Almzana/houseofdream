/**
 * Builds the path tracer's BVH in a Web Worker. Building it for a whole villa (~600k triangles,
 * SAH split, one triangle per leaf) takes seconds; on the main thread that froze the page while
 * "realistic" was being prepared. Same protocol as three-mesh-bvh's GenerateMeshBVHWorker, with
 * the worker bundled by Vite so it also loads in development.
 */
import { Box3, BufferAttribute, type BufferGeometry } from 'three';
import { MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh';
import BuildWorker from 'three-mesh-bvh/src/workers/generateMeshBVH.worker.js?worker';

export class BVHWorker {
  private worker: Worker | null = new BuildWorker();

  generate(geometry: BufferGeometry, options: MeshBVHOptions = {}): Promise<MeshBVH> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('BVH worker disposed'));
    return new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(`BVH worker: ${e.message}`));
      worker.onmessage = ({ data }) => {
        if (data.error) {
          worker.onmessage = null;
          reject(new Error(String(data.error)));
        } else if (data.serialized) {
          worker.onmessage = null;
          const { serialized, position } = data;
          const bvh = MeshBVH.deserialize(serialized, geometry, { setIndex: false });
          // the arrays were transferred to the worker and back: put the returned ones in place
          (geometry.attributes.position as BufferAttribute).array = position;
          if (serialized.index) {
            if (geometry.index) geometry.index.array = serialized.index;
            else geometry.setIndex(new BufferAttribute(serialized.index, 1, false));
          }
          geometry.boundingBox = bvh.getBoundingBox(new Box3());
          options.onProgress?.(1);
          resolve(bvh);
        } else options.onProgress?.(data.progress);
      };
      const index = geometry.index ? geometry.index.array : null;
      const position = geometry.attributes.position.array;
      const transfer = [position.buffer, ...(index ? [index.buffer] : [])];
      worker.postMessage(
        { index, position, options: { ...options, onProgress: null, includedProgressCallback: !!options.onProgress, groups: [...geometry.groups] } },
        transfer as Transferable[],
      );
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
