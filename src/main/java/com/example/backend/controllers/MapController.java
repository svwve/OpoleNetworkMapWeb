package com.example.backend.controllers;

import com.example.model.Camera;
import com.example.model.Fiber;
import com.example.repository.CameraRepository;
import com.example.repository.FiberRepository;
import com.example.repository.ProjectRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/map")
@Validated
public class MapController {

    private final CameraRepository cameraRepository;
    private final FiberRepository fiberRepository;
    private final ProjectRepository projectRepository;
    private final ObjectMapper objectMapper;

    @Autowired
    public MapController(CameraRepository cameraRepository, FiberRepository fiberRepository,
                         ProjectRepository projectRepository, ObjectMapper objectMapper) {
        this.cameraRepository = cameraRepository;
        this.fiberRepository = fiberRepository;
        this.projectRepository = projectRepository;
        this.objectMapper = objectMapper;
    }

    // ── Cameras ──────────────────────────────────────────────────────────────

    @GetMapping("/cameras")
    public ResponseEntity<List<Camera>> getCameras(
            @RequestParam(required = false) @Positive Long projectId) {
        if (projectId != null) {
            return ResponseEntity.ok(cameraRepository.findByProjectId(projectId));
        }
        return ResponseEntity.ok(cameraRepository.findAll());
    }

    @GetMapping("/cameras/{id}")
    public ResponseEntity<Camera> getCamera(@PathVariable @Positive Long id) {
        return cameraRepository.findById(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/cameras")
    public ResponseEntity<?> addCamera(@Valid @RequestBody CameraRequest request) {
        if (!projectRepository.existsById(request.projectId())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Wybrany projekt nie istnieje."));
        }
        Camera camera = new Camera();
        camera.setProjectId(request.projectId());
        camera.setName(request.name().trim());
        camera.setLat(request.lat());
        camera.setLng(request.lng());
        camera.setDescription(request.description());
        camera.setPhotoBase64(request.photoBase64());
        camera.setIsVisible(request.isVisible() == null || request.isVisible());
        return ResponseEntity.ok(cameraRepository.save(camera));
    }

    @PutMapping("/cameras/{id}")
    public ResponseEntity<?> updateCamera(@PathVariable @Positive Long id,
                                          @Valid @RequestBody CameraRequest request) {
        if (!projectRepository.existsById(request.projectId())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Wybrany projekt nie istnieje."));
        }
        return cameraRepository.findById(id).map(camera -> {
            camera.setLat(request.lat());
            camera.setLng(request.lng());
            camera.setName(request.name().trim());
            camera.setDescription(request.description());
            camera.setPhotoBase64(request.photoBase64());
            camera.setProjectId(request.projectId());
            camera.setIsVisible(request.isVisible() == null || request.isVisible());
            return ResponseEntity.ok(cameraRepository.save(camera));
        }).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/cameras/{id}")
    public ResponseEntity<?> deleteCamera(@PathVariable @Positive Long id) {
        if (cameraRepository.existsById(id)) {
            cameraRepository.deleteById(id);
            return ResponseEntity.ok(Map.of("success", true));
        }
        return ResponseEntity.notFound().build();
    }

    // ── Fibers ───────────────────────────────────────────────────────────────

    @GetMapping("/fibers")
    public ResponseEntity<List<Fiber>> getFibers(
            @RequestParam(required = false) @Positive Long projectId) {
        if (projectId != null) {
            return ResponseEntity.ok(fiberRepository.findByProjectId(projectId));
        }
        return ResponseEntity.ok(fiberRepository.findAll());
    }

    @GetMapping("/fibers/{id}")
    public ResponseEntity<Fiber> getFiber(@PathVariable @Positive Long id) {
        return fiberRepository.findById(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/fibers")
    public ResponseEntity<?> addFiber(@Valid @RequestBody FiberRequest request) {
        if (!projectRepository.existsById(request.projectId())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Wybrany projekt nie istnieje."));
        }
        if (!hasValidFiberPath(request.pathJson())) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Trasa światłowodu musi zawierać co najmniej dwa prawidłowe punkty."
            ));
        }
        Fiber fiber = new Fiber();
        fiber.setProjectId(request.projectId());
        fiber.setName(request.name().trim());
        fiber.setPathJson(request.pathJson());
        fiber.setColor(request.color());
        fiber.setThickness(request.thickness());
        fiber.setIsVisible(request.isVisible() == null || request.isVisible());
        return ResponseEntity.ok(fiberRepository.save(fiber));
    }

    @PutMapping("/fibers/{id}")
    public ResponseEntity<?> updateFiber(@PathVariable @Positive Long id,
                                         @Valid @RequestBody FiberRequest request) {
        if (!projectRepository.existsById(request.projectId())) {
            return ResponseEntity.badRequest().body(Map.of("error", "Wybrany projekt nie istnieje."));
        }
        if (!hasValidFiberPath(request.pathJson())) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Trasa światłowodu musi zawierać co najmniej dwa prawidłowe punkty."
            ));
        }
        return fiberRepository.findById(id).map(fiber -> {
            fiber.setName(request.name().trim());
            fiber.setPathJson(request.pathJson());
            fiber.setColor(request.color());
            fiber.setThickness(request.thickness());
            fiber.setProjectId(request.projectId());
            fiber.setIsVisible(request.isVisible() == null || request.isVisible());
            return ResponseEntity.ok(fiberRepository.save(fiber));
        }).orElseGet(() -> ResponseEntity.notFound().build());
    }

    private boolean hasValidFiberPath(String pathJson) {
        try {
            JsonNode points = objectMapper.readTree(pathJson);
            if (points == null || !points.isArray() || points.size() < 2) {
                return false;
            }
            for (JsonNode point : points) {
                if (!point.isArray() || point.size() != 2
                        || !point.get(0).isNumber() || !point.get(1).isNumber()) {
                    return false;
                }
                double lat = point.get(0).asDouble();
                double lng = point.get(1).asDouble();
                if (!Double.isFinite(lat) || !Double.isFinite(lng)
                        || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    return false;
                }
            }
            return true;
        } catch (IOException exception) {
            return false;
        }
    }

    @DeleteMapping("/fibers/{id}")
    public ResponseEntity<?> deleteFiber(@PathVariable @Positive Long id) {
        if (fiberRepository.existsById(id)) {
            fiberRepository.deleteById(id);
            return ResponseEntity.ok(Map.of("success", true));
        }
        return ResponseEntity.notFound().build();
    }
}
