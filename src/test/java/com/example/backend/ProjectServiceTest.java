package com.example.backend;

import com.example.model.Project;
import com.example.repository.ProjectRepository;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProjectServiceTest {

    private final ProjectRepository projectRepository = mock(ProjectRepository.class);
    private final ProjectService projectService = new ProjectService(projectRepository);

    @Test
    void createsOpoleProjectWhenNoProjectsExist() {
        when(projectRepository.findAll()).thenReturn(List.of());
        when(projectRepository.save(any(Project.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        Project project = projectService.getOrCreateDefaultProject(23);

        assertEquals("Opole", project.getName());
        assertEquals(23, project.getUserId());
        verify(projectRepository).save(any(Project.class));
    }

    @Test
    void returnsFirstExistingProjectInsteadOfCreatingAnother() {
        Project existingProject = new Project(10L, "Existing", 23);
        when(projectRepository.findAll()).thenReturn(List.of(existingProject));

        Project project = projectService.getOrCreateDefaultProject(23);

        assertEquals(existingProject, project);
        verify(projectRepository, never()).save(any(Project.class));
    }
}
