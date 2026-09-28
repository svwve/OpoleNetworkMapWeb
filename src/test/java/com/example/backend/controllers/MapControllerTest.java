package com.example.backend.controllers;

import com.example.model.Camera;
import com.example.model.Fiber;
import com.example.repository.CameraRepository;
import com.example.repository.FiberRepository;
import com.example.repository.ProjectRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class MapControllerTest {

    @Mock
    private CameraRepository cameraRepository;

    @Mock
    private FiberRepository fiberRepository;

    @Mock
    private ProjectRepository projectRepository;

    private MapController mapController;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;
    private LocalValidatorFactoryBean validator;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        mapController = new MapController(cameraRepository, fiberRepository, projectRepository, objectMapper);
        validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mockMvc = MockMvcBuilders.standaloneSetup(mapController)
                .setValidator(validator)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void rejectsCameraWithoutNameBeforeSaving() throws Exception {
        String body = """
                {"projectId":7,"name":" ","lat":50.6,"lng":17.9,"isVisible":true}
                """;

        mockMvc.perform(post("/api/map/cameras")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());

        verify(cameraRepository, never()).save(any(Camera.class));
    }

    @Test
    void rejectsOutOfRangeCameraCoordinatesBeforeSaving() throws Exception {
        String body = """
                {"projectId":7,"name":"Test","lat":91,"lng":17.9,"isVisible":true}
                """;

        mockMvc.perform(post("/api/map/cameras")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());

        verify(cameraRepository, never()).save(any(Camera.class));
    }

    @Test
    void savesValidCameraWithoutAcceptingClientSuppliedId() throws Exception {
        when(projectRepository.existsById(7L)).thenReturn(true);
        when(cameraRepository.save(any(Camera.class))).thenAnswer(invocation -> invocation.getArgument(0));
        CameraRequest request = new CameraRequest(7L, "Kamera", null, null, 50.6, 17.9, true);

        mockMvc.perform(post("/api/map/cameras")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Kamera"))
                .andExpect(jsonPath("$.lat").value(50.6))
                .andExpect(jsonPath("$.lng").value(17.9));

        verify(cameraRepository).save(any(Camera.class));
    }

    @Test
    void rejectsFiberWithEmptyOrInvalidCoordinatePath() throws Exception {
        String body = """
                {"projectId":7,"name":"Trasa","pathJson":"[]","color":"#0000FF","thickness":3}
                """;

        when(projectRepository.existsById(7L)).thenReturn(true);
        mockMvc.perform(post("/api/map/fibers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());

        verify(fiberRepository, never()).save(any(Fiber.class));
    }

    @Test
    void rejectsFiberPathWithOutOfRangeCoordinates() throws Exception {
        String body = """
                {"projectId":7,"name":"Trasa","pathJson":"[[91,17.9],[50.7,18.0]]","color":"#0000FF","thickness":3}
                """;

        when(projectRepository.existsById(7L)).thenReturn(true);
        mockMvc.perform(post("/api/map/fibers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());

        verify(fiberRepository, never()).save(any(Fiber.class));
    }

    @Test
    void savesFiberOnlyWhenItHasTwoValidPoints() throws Exception {
        when(projectRepository.existsById(7L)).thenReturn(true);
        when(fiberRepository.save(any(Fiber.class))).thenAnswer(invocation -> invocation.getArgument(0));
        FiberRequest request = new FiberRequest(
                7L, "Trasa", "[[50.6,17.9],[50.7,18.0]]", "#0000FF", 3, true);

        mockMvc.perform(post("/api/map/fibers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Trasa"));

        verify(fiberRepository).save(any(Fiber.class));
    }
}
