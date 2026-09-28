package com.example.model;

import jakarta.persistence.*;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@Entity
@Table(name = "fibers")
public class Fiber {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotNull
    @Positive
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @NotBlank
    @Size(max = 255)
    @Column(nullable = false, length = 255)
    private String name;

    @NotBlank
    @Size(max = 1_000_000)
    @Column(name = "path_json", columnDefinition = "TEXT")
    private String pathJson;

    @NotBlank
    @Pattern(regexp = "^#[0-9a-fA-F]{6}$")
    private String color = "#0000FF"; // Default blue
    
    @NotNull
    @Min(1)
    @Max(12)
    private Integer thickness = 3; // Default thickness
    
    @Column(name = "is_visible")
    private Boolean isVisible = true;

    public Fiber() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public void setProjectId(Long projectId) {
        this.projectId = projectId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPathJson() {
        return pathJson;
    }

    public void setPathJson(String pathJson) {
        this.pathJson = pathJson;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public Integer getThickness() {
        return thickness;
    }

    public void setThickness(Integer thickness) {
        this.thickness = thickness;
    }

    @JsonProperty("isVisible")
    public Boolean getIsVisible() {
        return isVisible;
    }

    @JsonProperty("isVisible")
    public void setIsVisible(Boolean visible) {
        isVisible = visible;
    }
}
