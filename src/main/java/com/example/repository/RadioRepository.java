package com.example.repository;

import com.example.model.Radio;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RadioRepository extends JpaRepository<Radio, Long> {
    List<Radio> findByProjectId(Long projectId);
}
