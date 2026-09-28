package com.example.backend;

import com.example.model.Project;
import com.example.repository.ProjectRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class ProjectService {

    private final ProjectRepository projectRepository;

    @Autowired
    public ProjectService(ProjectRepository projectRepository) {
        this.projectRepository = projectRepository;
    }

    public List<Project> getProjects() {
        return projectRepository.findAll();
    }

    public Optional<Project> getProjectById(Long id) {
        return projectRepository.findById(id);
    }

    public Project createProject(String name, Integer userId) {
        if (name == null || name.trim().isEmpty()) {
            return null;
        }

        Project project = new Project(null, name.trim(), userId);
        return projectRepository.save(project);
    }

    public Project updateProject(Long id, String name, Integer userId) {
        return projectRepository.findById(id).map(project -> {
            if (name != null && !name.trim().isEmpty()) {
                project.setName(name.trim());
            }
            if (userId != null) {
                project.setUserId(userId);
            }
            return projectRepository.save(project);
        }).orElse(null);
    }

    public boolean deleteProject(Long id) {
        if (projectRepository.existsById(id)) {
            projectRepository.deleteById(id);
            return true;
        }
        return false;
    }
}
