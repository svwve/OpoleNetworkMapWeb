package com.example.backend.controllers;

import com.example.model.Camera;
import com.example.model.Fiber;
import com.example.model.Radio;
import com.example.repository.CameraRepository;
import com.example.repository.FiberRepository;
import com.example.repository.ProjectRepository;
import com.example.repository.RadioRepository;
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

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class MapControllerTest {

    @Mock
    private CameraRepository cameraRepository;

    @Mock
    private RadioRepository radioRepository;

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
        mapController = new MapController(
                cameraRepository, radioRepository, fiberRepository, projectRepository, objectMapper);
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
    void savesValidRadio() throws Exception {
        when(projectRepository.existsById(7L)).thenReturn(true);
        when(radioRepository.save(any(Radio.class))).thenAnswer(invocation -> invocation.getArgument(0));
        RadioRequest request = new RadioRequest(
                7L, "Radio", null, null, 50.6, 17.9, true);

        mockMvc.perform(post("/api/map/radios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Radio"))
                .andExpect(jsonPath("$.lat").value(50.6))
                .andExpect(jsonPath("$.lng").value(17.9));

        verify(radioRepository).save(any(Radio.class));
    }

    @Test
    void savesRadioWhenCoordinatesUseLatitudeAndLongitudeAndPhotoIsOmitted() throws Exception {
        when(projectRepository.existsById(7L)).thenReturn(true);
        when(radioRepository.save(any(Radio.class))).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc.perform(post("/api/map/radios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"projectId":7,"name":"Radio","latitude":50.6,"longitude":17.9}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Radio"))
                .andExpect(jsonPath("$.lat").value(50.6))
                .andExpect(jsonPath("$.lng").value(17.9));

        verify(radioRepository).save(any(Radio.class));
    }

    @Test
    void rejectsRadioWithoutProjectBeforeSaving() throws Exception {
        when(projectRepository.existsById(7L)).thenReturn(false);
        RadioRequest request = new RadioRequest(
                7L, "Radio", null, null, 50.6, 17.9, true);

        mockMvc.perform(post("/api/map/radios")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());

        verify(radioRepository, never()).save(any(Radio.class));
    }

    @Test
    void listsRadiosForProject() throws Exception {
        Radio radio = new Radio();
        radio.setName("Radio");
        when(radioRepository.findByProjectId(7L)).thenReturn(List.of(radio));

        mockMvc.perform(get("/api/map/radios").param("projectId", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Radio"));
    }

    @Test
    void updatesRadio() throws Exception {
        Radio radio = new Radio();
        radio.setId(11L);
        radio.setProjectId(7L);
        radio.setName("Stare radio");
        radio.setLat(50.6);
        radio.setLng(17.9);
        when(projectRepository.existsById(7L)).thenReturn(true);
        when(radioRepository.findById(11L)).thenReturn(Optional.of(radio));
        when(radioRepository.save(any(Radio.class))).thenAnswer(invocation -> invocation.getArgument(0));
        RadioRequest request = new RadioRequest(
                7L, "Nowe radio", null, null, 50.7, 18.0, true);

        mockMvc.perform(put("/api/map/radios/11")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Nowe radio"))
                .andExpect(jsonPath("$.lat").value(50.7));

        verify(radioRepository).save(any(Radio.class));
    }

    @Test
    void deletesRadio() throws Exception {
        when(radioRepository.existsById(11L)).thenReturn(true);

        mockMvc.perform(delete("/api/map/radios/11"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(radioRepository).deleteById(11L);
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
